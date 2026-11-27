"""
Vision Trainer — web app for collecting, labeling, training and deploying YOLO object detection
on the line.   Run:  python run.py   then open http://<this-pc>:8600
"""
import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import cv2
from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db
from .camera import CameraService
from .config import ROOT, SETTINGS
from .images import (content_key, decode, delete_image, get_image, image_path, save_image, set_annotation, summary,
                     thumb_path)
from .plc import PlcLink
from .runtime import CACHE, Runtime, draw_dets, hits_of, stage_model, thresholds
from .training import TrainManager, preflight

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

camera = CameraService(SETTINGS["camera"])
runtime = None
plc = PlcLink(SETTINGS["plc"], on_trigger=lambda t: runtime.on_trigger(t))
runtime = Runtime(camera, plc)
trainer = TrainManager()


@asynccontextmanager
async def lifespan(app):
    db.conn()
    db.ex("UPDATE models SET status='failed', error='server restarted during training' WHERE status='training'")
    if SETTINGS["camera"]["enabled"]:
        camera.start()
    plc.start()
    CACHE.warm_project(runtime.project_id)
    yield
    trainer.cancel()
    plc.stop()
    camera.stop()


app = FastAPI(title="Vision Trainer", lifespan=lifespan)
STATIC = ROOT / "static"


def _404(x, what="ไม่พบข้อมูล"):
    if x is None or (not hasattr(x, "shape") and not x):
        raise HTTPException(404, what)
    return x


# ------------------------------------------------------------------ system
@app.get("/api/status")
def status():
    return {"camera": camera.status(), "plc": plc.status(), "train": trainer.status(),
            "runtime_project": runtime.project_id, "auto_capture": runtime.auto_capture,
            "config": {"runtime": SETTINGS["runtime"], "presets": SETTINGS["training"]["presets"],
                       "capture": SETTINGS["capture"]}}


# ------------------------------------------------------------------ projects
class ProjectIn(BaseModel):
    name: str
    station: str = ""
    classes: List[str]


def _clean_classes(cs):
    cs = [c.strip() for c in cs if c and c.strip()]
    if not cs:
        raise HTTPException(400, "ต้องมีอย่างน้อย 1 class")
    if len(set(cs)) != len(cs):
        raise HTTPException(400, "ชื่อ class ซ้ำกัน")
    if len(cs) > 9:
        raise HTTPException(400, "ไม่เกิน 9 class ต่อโปรเจกต์ (ใช้คีย์ 1–9)")
    return cs


@app.get("/api/projects")
def list_projects():
    ps = db.q("SELECT * FROM projects ORDER BY id DESC")
    for p in ps:
        p["classes"] = json.loads(p["classes"])
        p["n_images"] = db.q1("SELECT COUNT(*) n FROM images WHERE project_id=?", (p["id"],))["n"]
        live = stage_model(p["id"], "live")
        p["live_version"] = live and live["version"]
    return ps


@app.post("/api/projects")
def create_project(body: ProjectIn):
    pid = db.ex("INSERT INTO projects(name, station, classes, created) VALUES(?,?,?,?)",
                (body.name.strip() or "โปรเจกต์ใหม่", body.station.strip(),
                 json.dumps(_clean_classes(body.classes), ensure_ascii=False), db.now()))
    db.project_dir(pid)
    return db.get_project(pid)


@app.put("/api/projects/{pid}")
def update_project(pid: int, body: ProjectIn):
    p = _404(db.get_project(pid))
    cs = _clean_classes(body.classes)
    if cs[:len(p["classes"])] != p["classes"]:      # only appending new classes keeps old labels valid
        used = db.q1("SELECT COUNT(*) n FROM boxes b JOIN images i ON i.id=b.image_id WHERE i.project_id=?", (pid,))
        if used["n"]:
            raise HTTPException(400, "มีกรอบที่ label ไว้แล้ว — เพิ่ม class ต่อท้ายได้ แต่ห้ามลบหรือเรียงใหม่")
    db.ex("UPDATE projects SET name=?, station=?, classes=? WHERE id=?",
          (body.name.strip(), body.station.strip(), json.dumps(cs, ensure_ascii=False), pid))
    return db.get_project(pid)


@app.get("/api/projects/{pid}")
def project(pid: int):
    p = _404(db.get_project(pid))
    p["summary"] = summary(pid)
    return p


@app.put("/api/projects/{pid}/auto-retrain")
def set_auto_retrain(pid: int, enabled: bool = Body(..., embed=True)):
    db.ex("UPDATE projects SET auto_retrain=? WHERE id=?", (1 if enabled else 0, pid))
    return {"ok": True}


# ------------------------------------------------------------------ images
@app.get("/api/projects/{pid}/images")
def list_images(pid: int, status: Optional[str] = None, limit: int = 200, offset: int = 0, order: str = "asc"):
    where, args = "project_id=?", [pid]
    if status:
        where += " AND status=?"
        args.append(status)
    rows = db.q(f"SELECT id, status, source, w, h, score, created, "
                f"(SELECT COUNT(*) FROM boxes b WHERE b.image_id=images.id) n_boxes, "
                f"(SELECT COUNT(*) FROM boxes b WHERE b.image_id=images.id AND b.confirmed=0) n_pending "
                f"FROM images WHERE {where} ORDER BY id {'DESC' if order == 'desc' else 'ASC'} LIMIT ? OFFSET ?",
                args + [limit, offset])
    total = db.q1(f"SELECT COUNT(*) n FROM images WHERE {where}", args)["n"]
    return {"total": total, "items": rows}


@app.post("/api/projects/{pid}/images")
async def upload_images(pid: int, files: List[UploadFile] = File(...), dedupe: bool = True):
    _404(db.get_project(pid))
    added, dup, bad = 0, 0, 0
    for f in files:
        data = await f.read()
        img = decode(data)
        if img is None:
            bad += 1
            continue
        iid, is_dup = save_image(pid, img, source="upload", key=content_key(data) if dedupe else None)
        added += iid is not None
        dup += is_dup
    return {"added": added, "duplicates": dup, "unreadable": bad}


@app.get("/api/images/{iid}")
def image_info(iid: int):
    return _404(get_image(iid))


@app.get("/api/images/{iid}/file")
def image_file(iid: int):
    img = _404(db.q1("SELECT * FROM images WHERE id=?", (iid,)))
    return FileResponse(image_path(img), media_type="image/jpeg")


@app.get("/api/images/{iid}/thumb")
def image_thumb(iid: int):
    img = _404(db.q1("SELECT * FROM images WHERE id=?", (iid,)))
    return FileResponse(thumb_path(img), media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


class Annotation(BaseModel):
    boxes: list = []
    ok: bool = False


@app.put("/api/images/{iid}/annotation")
def save_annotation(iid: int, body: Annotation):
    img = _404(db.q1("SELECT * FROM images WHERE id=?", (iid,)))
    n = len(db.get_project(img["project_id"])["classes"])
    if any(int(b.get("cls", -1)) not in range(n) for b in body.boxes):
        raise HTTPException(400, "class ไม่ถูกต้อง")
    return set_annotation(iid, body.boxes, body.ok)


@app.delete("/api/images/{iid}")
def remove_image(iid: int):
    delete_image(iid)
    return {"ok": True}


def _load(iid):
    img = _404(db.q1("SELECT * FROM images WHERE id=?", (iid,)))
    frame = cv2.imread(str(image_path(img)))
    return img, _404(frame, "อ่านไฟล์ภาพไม่ได้")


def _latest_model(pid):
    return (stage_model(pid, "live") or
            db.q1("SELECT * FROM models WHERE project_id=? AND status='done' ORDER BY id DESC LIMIT 1", (pid,)))


@app.post("/api/images/{iid}/prelabel")
def prelabel(iid: int, model_id: Optional[int] = Body(None), conf: Optional[float] = Body(None)):
    """AI-assisted labeling: boxes from a chosen trained model (default: live, else latest)."""
    img, frame = _load(iid)
    if model_id:
        m = _404(db.q1("SELECT * FROM models WHERE id=? AND project_id=? AND status='done'",
                       (model_id, img["project_id"])), "ไม่พบโมเดลนี้")
    else:
        m = _latest_model(img["project_id"])
    if not m:
        raise HTTPException(409, "ยังไม่มีโมเดล — เทรนโหมดเร็วสักครั้งก่อน (label ประมาณ 30 ภาพ)")
    c = SETTINGS["prelabel"]["conf"] if conf is None else min(0.95, max(0.01, float(conf)))
    dets = CACHE.predict(m, frame, conf=c)
    return {"model_version": m["version"], "boxes": [dict(d, origin="ai", confirmed=False) for d in dets]}


@app.post("/api/images/{iid}/sam")
def sam_click(iid: int, x: float = Body(...), y: float = Body(...)):
    img, frame = _load(iid)
    try:
        box = CACHE.sam_box(frame, x, y)
    except Exception as e:
        raise HTTPException(503, f"โหลด SAM ไม่ได้ ({SETTINGS['sam']['model']}): {e}")
    return {"box": box}


# ------------------------------------------------------------------ camera / capture
@app.get("/api/camera/status")
def camera_status():
    return camera.status()


@app.post("/api/camera/{action}")
def camera_action(action: str):
    if action == "start":
        camera.start()
    elif action == "stop":
        camera.stop()
    elif action == "restart":
        camera.stop(); camera.start()
    else:
        raise HTTPException(404)
    return camera.status()


@app.get("/api/camera/stream")
async def camera_stream(infer: bool = False, pid: Optional[int] = None):
    """MJPEG. infer=1 & pid: draw the live model's detections on every frame (setup / monitor view)."""
    model = classes = None
    if infer and pid:
        model = stage_model(pid, "live") or _latest_model(pid)
        classes = db.get_project(pid)["classes"] if model else None

    def render(f):
        if model:
            try:
                dets = hits_of(CACHE.predict(model, f), model)
                f = draw_dets(f, dets, classes)
            except Exception as e:
                cv2.putText(f, f"infer error: {e}"[:80], (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        s = 960 / max(f.shape[1], 1)
        if s < 1:
            f = cv2.resize(f, (960, int(f.shape[0] * s)), interpolation=cv2.INTER_AREA)
        ok, jpg = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 75])
        return jpg.tobytes() if ok else None

    async def gen():
        last = 0
        while True:
            if camera.frame is not None and camera.frame_t != last:
                last = camera.frame_t
                jpg = await asyncio.to_thread(render, camera.latest())
                if jpg:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
            await asyncio.sleep(0.12 if model else 0.07)
    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")


# ------------------------------------------------------------------ line monitor
@app.get("/api/monitor")
def monitor(pid: int):
    p = _404(db.get_project(pid))
    lt = time.localtime()
    midnight = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))
    c = db.q1("SELECT COUNT(*) n, SUM(live_verdict='OK') ok, SUM(live_verdict='NG') ng, "
              "SUM(live_verdict='ERROR') err, AVG(ms) ms FROM inspections WHERE project_id=? AND ts>=?",
              (pid, midnight))
    recent = db.q("SELECT id, ts, live_verdict, live_score, live_classes, shadow_verdict, codes, ms, "
                  "image_path IS NOT NULL has_img FROM inspections WHERE project_id=? ORDER BY id DESC LIMIT 15",
                  (pid,))
    last = runtime.last if runtime.last and runtime.last.get("project_id") == pid else None
    return {"project": {"id": p["id"], "name": p["name"], "station": p["station"], "classes": p["classes"]},
            "enabled": runtime.project_id == pid, "live": _brief_model(stage_model(pid, "live")),
            "shadow": _brief_model(stage_model(pid, "shadow")), "last": last,
            "today": {k: c[k] or 0 for k in ("n", "ok", "ng", "err")} | {"ms": round(c["ms"] or 0, 1)},
            "recent": recent, "camera": camera.status(), "plc": plc.status(), "auto_capture": runtime.auto_capture}


def _brief_model(m):
    return m and {"id": m["id"], "version": m["version"], "threshold": m["threshold"],
                  "class_thresholds": json.loads(m.get("class_thresholds") or "{}")}


@app.get("/api/monitor/last.jpg")
def monitor_last_jpg():
    if not runtime.last_jpg:
        raise HTTPException(404, "ยังไม่มีภาพ")
    return Response(runtime.last_jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/projects/{pid}/capture")
def capture(pid: int):
    _404(db.get_project(pid))
    t, f = camera.frame_t, camera.latest()
    if f is None:
        raise HTTPException(409, "ยังไม่มีภาพจากกล้อง: " + (camera.error or "กล้องไม่ได้เปิด"))
    iid, dup = save_image(pid, f, source="camera", key=f"cam:{t:.6f}")
    return {"image_id": iid, "duplicate": dup}


@app.put("/api/capture/auto")
def set_auto_capture(project_id: int = Body(...), enabled: bool = Body(...)):
    db.kv_set("auto_capture", {"project_id": project_id, "enabled": enabled})
    return runtime.auto_capture


@app.post("/api/plc/test-trigger")
def test_trigger():
    """Same as receiving COMMAND1 from the PLC — for testing from the browser."""
    t = time.time()
    plc.triggers += 1
    res = runtime.on_trigger(t)
    return {"result": res, "plc": plc.status()}


# ------------------------------------------------------------------ training
@app.get("/api/projects/{pid}/preflight")
def get_preflight(pid: int, preset: str = "fast"):
    _404(db.get_project(pid))
    return preflight(pid, preset)


@app.post("/api/projects/{pid}/train")
def start_train(pid: int, preset: str = Body("fast"), overrides: dict = Body(default={})):
    _404(db.get_project(pid))
    try:
        mid = trainer.start(pid, preset, overrides)
    except (RuntimeError, ValueError) as e:
        raise HTTPException(409, str(e))
    return {"model_id": mid}


@app.get("/api/train/status")
def train_status():
    return trainer.status()


@app.post("/api/train/cancel")
def train_cancel():
    return {"cancelled": trainer.cancel()}


# ------------------------------------------------------------------ models / results / deploy
def eval_summary(ev, thr):
    """Image-level result: NG if any class score >= that class's threshold (thr: cls -> value)."""
    if not ev:
        return None
    missed = fa = ng = 0
    for im in ev["images"]:
        pred = any(float(v) >= thr(int(c)) for c, v in im["scores"].items())
        if im["gt"]:
            ng += 1
            missed += not pred
        else:
            fa += pred
    n = len(ev["images"])
    return {"n": n, "n_ng": ng, "n_ok": n - ng, "missed": missed, "false_alarm": fa}


def _model_out(m, full=False):
    m = dict(m)
    m["params"] = json.loads(m["params"] or "{}")
    m["metrics"] = json.loads(m["metrics"] or "null")
    ev = json.loads(m.pop("eval") or "null")
    m["eval_summary"] = eval_summary(ev, thresholds(m))
    m["class_thresholds"] = json.loads(m.get("class_thresholds") or "{}")
    if full:
        m["eval"] = ev
    return m


@app.get("/api/projects/{pid}/models")
def list_models(pid: int):
    return [_model_out(m) for m in db.q("SELECT * FROM models WHERE project_id=? ORDER BY version DESC", (pid,))]


@app.get("/api/models/{mid}")
def model(mid: int):
    return _model_out(_404(db.q1("SELECT * FROM models WHERE id=?", (mid,))), full=True)


@app.put("/api/models/{mid}/threshold")
def set_threshold(mid: int, threshold: float = Body(...), class_thresholds: Optional[dict] = Body(None)):
    """threshold = default for every class; class_thresholds = {"<cls>": value} overrides (empty = none)."""
    m = _404(db.q1("SELECT * FROM models WHERE id=?", (mid,)))
    n = len(db.get_project(m["project_id"])["classes"])
    per = {}
    for k, v in (class_thresholds or {}).items():
        if not str(k).isdigit() or int(k) >= n:
            raise HTTPException(400, "class ไม่ถูกต้อง")
        per[str(int(k))] = round(float(v), 3)
    if not all(0.01 <= v <= 0.99 for v in [threshold, *per.values()]):
        raise HTTPException(400, "threshold ต้องอยู่ระหว่าง 0.01–0.99")
    db.ex("UPDATE models SET threshold=?, class_thresholds=? WHERE id=?",
          (round(threshold, 3), json.dumps(per) if per else None, mid))
    return {"ok": True}


@app.get("/api/models/{mid}/download")
def download_model(mid: int, fmt: str = "pt"):
    m = _404(db.q1("SELECT * FROM models WHERE id=?", (mid,)))
    path = m["onnx"] if fmt == "onnx" else m["weights"]
    if not path or not Path(path).exists():
        raise HTTPException(404, "ไม่มีไฟล์")
    return FileResponse(path, filename=f"project{m['project_id']}_v{m['version']}{Path(path).suffix}")


@app.post("/api/models/{mid}/stage")
def set_stage(mid: int, stage: str = Body(..., embed=True)):
    """shadow: run beside live without driving the PLC. live: drive the PLC (old live -> archived)."""
    m = _404(db.q1("SELECT * FROM models WHERE id=?", (mid,)))
    if m["status"] != "done":
        raise HTTPException(409, "โมเดลนี้ยังเทรนไม่เสร็จ")
    if stage not in ("shadow", "live", "archived"):
        raise HTTPException(400)
    pid = m["project_id"]

    def fn(c):
        if stage in ("shadow", "live"):
            c.execute("UPDATE models SET stage='archived' WHERE project_id=? AND stage=? AND id!=?", (pid, stage, mid))
        if stage == "live":   # promoting the shadow ends the shadow run
            c.execute("UPDATE models SET stage='archived' WHERE project_id=? AND stage='shadow' AND id!=?", (pid, mid))
        c.execute("UPDATE models SET stage=?, deployed=? WHERE id=?", (stage, db.now(), mid))
    db.tx(fn)
    if stage in ("shadow", "live") and runtime.project_id is None:
        db.kv_set("runtime_project", pid)
    if stage in ("shadow", "live"):
        CACHE.warm_project(pid)
    return list_models(pid)


@app.get("/api/projects/{pid}/runtime")
def runtime_info(pid: int):
    return runtime.stats(pid)


@app.put("/api/runtime/project")
def set_runtime_project(project_id: Optional[int] = Body(None, embed=True)):
    db.kv_set("runtime_project", project_id)
    CACHE.warm_project(project_id)
    return {"runtime_project": project_id}


@app.get("/api/projects/{pid}/inspections")
def inspections(pid: int, disagree: bool = False, limit: int = 60):
    where = "project_id=?" + (" AND live_verdict IS NOT NULL AND shadow_verdict IS NOT NULL AND "
                              "live_verdict!=shadow_verdict" if disagree else "")
    return db.q(f"SELECT * FROM inspections WHERE {where} ORDER BY id DESC LIMIT ?", (pid, limit))


@app.get("/api/inspections/{xid}/image")
def inspection_image(xid: int):
    r = _404(db.q1("SELECT image_path FROM inspections WHERE id=?", (xid,)))
    return FileResponse(_404(r["image_path"], "ไม่ได้เก็บภาพของชิ้นนี้"), media_type="image/jpeg")


# ------------------------------------------------------------------ review queue (active learning)
@app.post("/api/images/{iid}/review")
def review(iid: int, verdict: str = Body(..., embed=True)):
    img = _404(db.q1("SELECT * FROM images WHERE id=?", (iid,)))
    if verdict == "ok":
        set_annotation(iid, [], ok=True)
    elif verdict == "ng":           # goes to the label screen with AI suggestions
        boxes = []
        m = _latest_model(img["project_id"])
        if m:
            _, frame = _load(iid)
            boxes = [dict(d, origin="ai", confirmed=False)
                     for d in CACHE.predict(m, frame, conf=SETTINGS["prelabel"]["conf"])]
        set_annotation(iid, boxes)
        db.ex("UPDATE images SET status='unlabeled' WHERE id=?", (iid,))
    else:
        raise HTTPException(400, "verdict ต้องเป็น ok หรือ ng")
    pid = img["project_id"]
    db.ex("UPDATE projects SET reviewed_since_train=reviewed_since_train+1 WHERE id=?", (pid,))
    p = db.get_project(pid)
    every = SETTINGS["runtime"]["auto_retrain_every"]
    started = None
    if p["auto_retrain"] and every and p["reviewed_since_train"] >= every and not trainer.busy():
        try:
            started = trainer.start(pid, p["last_preset"] or "fast")
        except Exception as e:
            log.warning("auto retrain not started: %s", e)
    return {"reviewed_since_train": p["reviewed_since_train"], "auto_retrain_started": started}


# ------------------------------------------------------------------ static UI
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC / "index.html").read_text(encoding="utf-8")
