"""Dataset export, pre-flight checks and the (one-at-a-time) training job manager."""
import json
import logging
import math
import os
import random
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from . import db
from .config import ROOT, SETTINGS
from .images import image_path, summary, yolo_label_lines

log = logging.getLogger("training")


def resolve_base_model(name):
    """models/<name> if the file was copied there (offline plants), otherwise Ultralytics downloads it."""
    local = ROOT / "models" / name
    return str(local) if local.exists() else name


# augmentation keys passed to Ultralytics, with the allowed range of each
AUG_RANGES = {"hsv_h": (0, 0.1), "hsv_s": (0, 1), "hsv_v": (0, 1), "degrees": (0, 45), "translate": (0, 0.5),
              "scale": (0, 0.9), "fliplr": (0, 1), "flipud": (0, 1), "mosaic": (0, 1), "mixup": (0, 1)}


def clean_augment(aug):
    out = {}
    for k, v in (aug or {}).items():
        if k not in AUG_RANGES or v in (None, ""):
            continue
        lo, hi = AUG_RANGES[k]
        v = float(v)
        if not lo <= v <= hi:
            raise ValueError(f"augmentation {k} ต้องอยู่ระหว่าง {lo}–{hi}")
        out[k] = v
    return out


def preset_params(preset, overrides=None):
    """settings training.augment <- preset "augment" <- overrides["augment"] (from the web page)."""
    presets = SETTINGS["training"]["presets"]
    if preset not in presets:
        raise ValueError(f"ไม่มี preset '{preset}'")
    p = dict(presets[preset])
    p["augment"] = {**clean_augment(SETTINGS["training"].get("augment")), **clean_augment(presets[preset].get("augment"))}
    for k, v in (overrides or {}).items():
        if k in ("model", "epochs", "imgsz", "patience", "batch") and v not in (None, ""):
            p[k] = str(v).strip() if k == "model" else int(v)
        elif k == "augment":
            p["augment"].update(clean_augment(v))
    if not str(p["model"]).lower().endswith((".pt", ".yaml", ".yml")):
        raise ValueError(f"base model '{p['model']}' ต้องลงท้ายด้วย .pt เช่น yolo26l.pt")
    return p


def labeled_images(pid):
    imgs = db.q("SELECT * FROM images WHERE project_id=? AND status='labeled' ORDER BY id", (pid,))
    boxes = db.q("SELECT b.* FROM boxes b JOIN images i ON i.id=b.image_id WHERE i.project_id=? "
                 "AND i.status='labeled' AND b.confirmed=1", (pid,))
    by = {}
    for b in boxes:
        by.setdefault(b["image_id"], []).append(b)
    for i in imgs:
        i["boxes"] = by.get(i["id"], [])
    return imgs


def split(imgs, ratio):
    """Stratified by the image's rarest class, fixed seed -> same split for the same images."""
    counts = {}
    for i in imgs:
        for c in {b["cls"] for b in i["boxes"]}:
            counts[c] = counts.get(c, 0) + 1
    groups = {}
    for i in imgs:
        cs = {b["cls"] for b in i["boxes"]}
        key = min(cs, key=lambda c: counts[c]) if cs else -1
        groups.setdefault(key, []).append(i)
    train, val = [], []
    for key, g in sorted(groups.items()):
        g = sorted(g, key=lambda x: x["id"])
        random.Random(1000 + key).shuffle(g)
        k = math.ceil(len(g) * ratio) if len(g) >= 2 else 0
        val += g[:k]
        train += g[k:]
    return train, val


def preflight(pid, preset="fast"):
    p = db.get_project(pid)
    s = summary(pid)
    params = preset_params(preset)
    checks = []
    n = s["labeled"]
    checks.append({"level": "ok" if n >= 20 else "error",
                   "text": f"label แล้ว {n} ภาพ (ชิ้นงานดี {s['rows'][0]['n']} ภาพ)"
                           + ("" if n >= 20 else " — ต้องมีอย่างน้อย 20 ภาพ")})
    if s["unlabeled"]:
        checks.append({"level": "warn", "text": f"ยังไม่ label {s['unlabeled']} ภาพ — จะไม่ถูกใช้เทรนรอบนี้"})
    defects = sum(r["n"] for r in s["rows"][1:])
    if defects == 0:
        checks.append({"level": "error", "text": "ยังไม่มีภาพที่มีกรอบตำหนิเลย"})
    for r in s["rows"][1:]:
        if 0 < r["n"] < SETTINGS["capture"]["min_per_class"]:
            checks.append({"level": "warn", "text": f"{r['name']} มี {r['n']} ภาพ ต่ำกว่าที่แนะนำ "
                           f"({SETTINGS['capture']['min_per_class']}) — เทรนได้ แต่จะจับ {r['name']} ได้น้อย"})
        elif r["n"] == 0:
            checks.append({"level": "warn", "text": f"{r['name']} ยังไม่มีภาพ — โมเดลจะจับ class นี้ไม่ได้"})
    vr = SETTINGS["training"]["val_ratio"]
    checks.append({"level": "ok", "text": f"แบ่งชุดเทรน/ทดสอบอัตโนมัติ {round((1 - vr) * 100)}/{round(vr * 100)} "
                                         "แยกตามประเภทตำหนิ"})
    if s["min_box_px"] is not None:
        scale = params["imgsz"] / max(1, max(i["w"] for i in db.q(
            "SELECT w FROM images WHERE project_id=? AND status='labeled'", (pid,))))
        px = s["min_box_px"] * min(1.0, scale)
        lvl = "ok" if px >= 8 else "warn"
        checks.append({"level": lvl, "text": f"กรอบเล็กสุด {s['min_box_px']:.0f} px "
                       f"(≈{px:.0f} px ที่ขนาดเทรน {params['imgsz']})"
                       + ("" if lvl == "ok" else " — เล็กเกินไป ลองโหมดแม่นยำหรือเพิ่ม imgsz")})
    return {"checks": checks, "can_train": not any(c["level"] == "error" for c in checks),
            "params": params, "classes": p["classes"]}


def _link_or_copy(src, dst):
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def export_dataset(pid, version):
    p = db.get_project(pid)
    imgs = labeled_images(pid)
    train, val = split(imgs, SETTINGS["training"]["val_ratio"])
    if not val:
        val = train[:max(1, len(train) // 5)]
    root = db.project_dir(pid) / "datasets" / f"v{version}"
    if root.exists():
        shutil.rmtree(root)
    for part, items in (("train", train), ("val", val)):
        (root / "images" / part).mkdir(parents=True)
        (root / "labels" / part).mkdir(parents=True)
        for i in items:
            src = image_path(i)
            _link_or_copy(src, root / "images" / part / i["filename"])
            (root / "labels" / part / (Path(i["filename"]).stem + ".txt")).write_text(
                "\n".join(yolo_label_lines(i["boxes"])), encoding="utf-8")
    yaml = root / "data.yaml"
    names = "\n".join(f"  {k}: {json.dumps(n, ensure_ascii=False)}" for k, n in enumerate(p["classes"]))
    yaml.write_text(f"path: {root.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n{names}\n",
                    encoding="utf-8")
    val_images = [{"id": i["id"], "path": str(root / "images" / "val" / i["filename"]),
                   "gt": sorted({b["cls"] for b in i["boxes"]})} for i in val]
    return yaml, val_images, len(train), len(val)


class TrainManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.job = None          # dict(model_id, project_id, proc, out_dir, ...)
        self.on_done = []        # callbacks(model_row)

    def busy(self):
        return self.job is not None

    def start(self, pid, preset, overrides=None):
        with self.lock:
            if self.job:
                raise RuntimeError("มีงานเทรนกำลังทำอยู่ — รอให้เสร็จหรือกดยกเลิกก่อน")
            pf = preflight(pid, preset)
            if not pf["can_train"]:
                raise RuntimeError("ยังเทรนไม่ได้: " + "; ".join(c["text"] for c in pf["checks"] if c["level"] == "error"))
            params = preset_params(preset, overrides)
            version = (db.q1("SELECT MAX(version) v FROM models WHERE project_id=?", (pid,))["v"] or 0) + 1
            yaml, val_images, ntr, nval = export_dataset(pid, version)
            mid = db.ex("INSERT INTO models(project_id, version, preset, params, status, stage, threshold, "
                        "n_images, created) VALUES(?,?,?,?,?,?,?,?,?)",
                        (pid, version, preset, json.dumps(params), "training", "none",
                         SETTINGS["runtime"]["default_threshold"], ntr + nval, db.now()))
            out = db.project_dir(pid) / "runs" / f"v{version}"
            if out.exists():
                shutil.rmtree(out)
            out.mkdir(parents=True)
            job = {"out_dir": str(out), "data_yaml": str(yaml), "params": params, "val_images": val_images,
                   "base_model": resolve_base_model(params["model"]), "device": SETTINGS["training"]["device"],
                   "workers": SETTINGS["training"]["workers"], "export_onnx": SETTINGS["training"]["export_onnx"],
                   "amp": SETTINGS["training"].get("amp", True)}
            # GPU fallbacks: a CUDA/cuDNN crash leaves the process unusable, so each try is a new process
            tries = [{"amp": job["amp"], "cudnn": True}]
            if job["amp"]:
                tries.append({"amp": False, "cudnn": True})
            tries.append({"amp": False, "cudnn": False})
            proc, logf = self._launch(out, job, tries[0], 1)
            db.ex("UPDATE projects SET last_preset=?, reviewed_since_train=0 WHERE id=?", (preset, pid))
            self.job = {"model_id": mid, "project_id": pid, "version": version, "proc": proc, "out": out,
                        "log": logf, "started": time.time(), "preset": preset, "n_train": ntr, "n_val": nval,
                        "cancelled": False, "job": job, "tries": tries, "attempt": 1}
            threading.Thread(target=self._wait, args=(self.job,), daemon=True).start()
            return mid

    def cancel(self):
        j = self.job
        if not j:
            return False
        j["cancelled"] = True
        j["proc"].terminate()
        return True

    @staticmethod
    def _launch(out, job, opts, attempt):
        job = dict(job, **opts, attempt=attempt)
        (out / "job.json").write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
        for f in ("result.json", "progress.json"):
            (out / f).unlink(missing_ok=True)
        shutil.rmtree(out / "train", ignore_errors=True)
        logf = open(out / "train.log", "a" if attempt > 1 else "w", encoding="utf-8")
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        proc = subprocess.Popen([sys.executable, "-m", "app.train_worker", str(out / "job.json")],
                                cwd=str(ROOT), stdout=logf, stderr=subprocess.STDOUT, env=env)
        return proc, logf

    GPU_ERRORS = ("cudnn", "cuda error", "illegal memory access", "cublas", "acceleratorerror")

    def _wait(self, j):
        while True:
            rc = j["proc"].wait()
            j["log"].close()
            res_path = j["out"] / "result.json"
            res = json.loads(res_path.read_text(encoding="utf-8")) if res_path.exists() else None
            err = ((res or {}).get("error") or "").lower()
            gpu_crash = rc != 0 and (any(k in err for k in self.GPU_ERRORS) or res is None)
            if j["cancelled"] or (res and res.get("ok")) or not gpu_crash or j["attempt"] >= len(j["tries"]):
                break
            nxt = j["tries"][j["attempt"]]
            j["attempt"] += 1
            log.warning("training v%s: GPU error (%s) — retry %d with amp=%s cudnn=%s",
                        j["version"], err[:120], j["attempt"], nxt["amp"], nxt["cudnn"])
            j["proc"], j["log"] = self._launch(j["out"], j["job"], nxt, j["attempt"])
            j["started"] = time.time()
        if j["cancelled"]:
            db.ex("UPDATE models SET status='cancelled', finished=? WHERE id=?", (db.now(), j["model_id"]))
        elif res and res.get("ok"):
            m = dict(res["metrics"], history=res.get("history", []), n_train=j["n_train"], n_val=j["n_val"])
            db.ex("UPDATE models SET status='done', weights=?, onnx=?, metrics=?, eval=?, finished=? WHERE id=?",
                  (res["weights"], res.get("onnx"), json.dumps(m), json.dumps(res["eval"]), db.now(), j["model_id"]))
        else:
            err = (res or {}).get("error") or f"worker exit code {rc}"
            try:    # the real cause is usually a few lines above the last error
                tail = (j["out"] / "train.log").read_text(encoding="utf-8", errors="replace")[-2500:]
                err += f"\n\n--- {j['out'] / 'train.log'} (ท้ายไฟล์) ---\n{tail}"
            except Exception:
                pass
            db.ex("UPDATE models SET status='failed', error=?, finished=? WHERE id=?", (err, db.now(), j["model_id"]))
            log.error("training v%s failed: %s", j["version"], err)
        with self.lock:
            self.job = None
        row = db.q1("SELECT * FROM models WHERE id=?", (j["model_id"],))
        for cb in self.on_done:
            try:
                cb(row)
            except Exception:
                log.exception("on_done callback")

    def status(self):
        j = self.job
        if not j:
            return {"running": False}
        prog = {}
        pp = j["out"] / "progress.json"
        if pp.exists():
            try:
                prog = json.loads(pp.read_text(encoding="utf-8"))
            except Exception:
                pass
        ep, eps = prog.get("epoch", 0), prog.get("epochs") or 1
        el = time.time() - j["started"]
        eta = (el / ep) * (eps - ep) if ep else None
        tail = ""
        try:
            tail = (j["out"] / "train.log").read_text(encoding="utf-8", errors="replace")[-1500:]
        except Exception:
            pass
        return {"running": True, "model_id": j["model_id"], "project_id": j["project_id"], "version": j["version"],
                "preset": j["preset"], "stage": prog.get("stage", "starting"), "epoch": ep, "epochs": eps,
                "pct": round(100 * ep / eps), "elapsed_s": round(el), "eta_s": round(eta) if eta else None,
                "history": prog.get("history", []), "log_tail": tail,
                "attempt": j["attempt"], "amp": prog.get("amp"), "cudnn": prog.get("cudnn")}
