"""
Training worker, run as a separate process by training.py:
    python -m app.train_worker <job.json>

Separate process = GPU memory is released when it ends, and Cancel can simply kill it.
Writes progress.json every epoch and result.json at the end.
"""
import json
import os
import sys
import time
import traceback
from pathlib import Path


def write_json(path, obj):
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def main(job_path):
    job = json.loads(Path(job_path).read_text(encoding="utf-8"))
    out = Path(job["out_dir"])
    prog_path, res_path = out / "progress.json", out / "result.json"
    p = job["params"]
    history = []
    t0 = time.time()
    state = {"stage": "loading", "epoch": 0, "epochs": p["epochs"], "history": history, "started": t0}
    write_json(prog_path, state)
    try:
        import torch
        from ultralytics import YOLO

        device = job["device"]
        if device == "auto":
            device = 0 if torch.cuda.is_available() else "cpu"
        amp = bool(job.get("amp", True)) and device != "cpu"

        def on_fit_epoch_end(trainer):
            m = trainer.metrics or {}
            history.append({"epoch": trainer.epoch + 1,
                            "map50": round(float(m.get("metrics/mAP50(B)", 0) or 0), 4),
                            "map": round(float(m.get("metrics/mAP50-95(B)", 0) or 0), 4)})
            state.update(stage="training", epoch=trainer.epoch + 1, epochs=trainer.epochs,
                         best_fitness=float(trainer.best_fitness or 0) if trainer.best_fitness is not None else None,
                         elapsed=time.time() - t0)
            write_json(prog_path, state)

        if not job.get("cudnn", True):
            torch.backends.cudnn.enabled = False     # native CUDA kernels: slower, avoids cuDNN bugs
        print(f"*** attempt {job.get('attempt', 1)}: amp={amp} cudnn={torch.backends.cudnn.enabled} "
              f"torch={torch.__version__} cuda={torch.version.cuda} cudnn_ver={torch.backends.cudnn.version()}",
              flush=True)
        model = YOLO(job["base_model"])
        model.add_callback("on_fit_epoch_end", on_fit_epoch_end)
        state.update(stage="training", amp=amp, cudnn=torch.backends.cudnn.enabled, attempt=job.get("attempt", 1))
        write_json(prog_path, state)
        model.train(data=job["data_yaml"], epochs=p["epochs"], imgsz=p["imgsz"], batch=p["batch"],
                    patience=p["patience"], device=device, workers=job["workers"], project=str(out),
                    name="train", exist_ok=True, plots=False, verbose=False, amp=amp, **p.get("augment", {}))
        best = out / "train" / "weights" / "best.pt"
        if not best.exists():
            best = out / "train" / "weights" / "last.pt"

        # final metrics on the validation set
        state["stage"] = "evaluating"
        write_json(prog_path, state)
        trained = YOLO(str(best))
        v = trained.val(data=job["data_yaml"], imgsz=p["imgsz"], batch=p["batch"], device=device,
                        plots=False, verbose=False, workers=job["workers"], project=str(out), name="val", exist_ok=True)
        metrics = {"amp": amp, "cudnn": torch.backends.cudnn.enabled, "map50": round(float(v.box.map50), 4), "map": round(float(v.box.map), 4),
                   "precision": round(float(v.box.mp), 4), "recall": round(float(v.box.mr), 4)}

        # image-level scores for the OK/NG threshold screen
        images, speeds = [], []
        for item in job["val_images"]:
            r = trained.predict(item["path"], conf=0.01, imgsz=p["imgsz"], device=device, verbose=False)[0]
            scores = {}
            for c, s in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                c = int(c)
                scores[c] = max(scores.get(c, 0.0), round(float(s), 4))
            speeds.append(r.speed.get("inference", 0))
            images.append({"id": item["id"], "gt": item["gt"], "scores": scores})
        metrics["inference_ms"] = round(sum(speeds) / max(1, len(speeds)), 1)

        onnx = None
        if job.get("export_onnx"):
            state["stage"] = "exporting"
            write_json(prog_path, state)
            try:
                onnx = str(YOLO(str(best)).export(format="onnx", imgsz=p["imgsz"], device=device))
            except Exception as e:      # onnx package missing etc. — not fatal
                metrics["onnx_error"] = str(e)[:300]

        state["stage"] = "done"
        write_json(prog_path, state)
        write_json(res_path, {"ok": True, "weights": str(best), "onnx": onnx, "metrics": metrics,
                              "eval": {"images": images}, "history": history})
    except BaseException as e:
        write_json(res_path, {"ok": False, "error": f"{type(e).__name__}: {e}",
                              "trace": traceback.format_exc()[-4000:], "history": history})
        raise


if __name__ == "__main__":
    main(sys.argv[1])
