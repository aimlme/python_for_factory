"""
Line runtime: on each PLC trigger -> grab the frame after the trigger -> run the LIVE model
(sends OK/NG codes to the PLC) and the SHADOW model (logged only) -> log -> uncertain images
go to the review queue. Also: AI pre-label suggestions and SAM click-to-box for the label screen.
"""
import json
import logging
import threading
import time

import cv2

from . import db
from .config import SETTINGS
from .images import save_image

log = logging.getLogger("runtime")


def _device():
    d = SETTINGS["training"]["device"]
    if d != "auto":
        return d
    try:
        import torch
        return 0 if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


class ModelCache:
    def __init__(self):
        self.lock = threading.Lock()
        self.models = {}
        self.sam = None
        self.device = None

    def get(self, path):
        from ultralytics import YOLO
        if path not in self.models:
            if len(self.models) > 4:
                self.models.pop(next(iter(self.models)))
            self.models[path] = YOLO(path)
        return self.models[path]

    def predict(self, model_row, img, conf=0.01):
        """-> list of dict(cls, conf, x1, y1, x2, y2) normalized."""
        if self.device is None:
            self.device = _device()
        imgsz = json.loads(model_row["params"] or "{}").get("imgsz", 640)
        with self.lock:
            m = self.get(model_row["weights"])
            r = m.predict(img, conf=conf, imgsz=imgsz, device=self.device, verbose=False)[0]
        h, w = img.shape[:2]
        out = []
        for (x1, y1, x2, y2), c, s in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
            out.append({"cls": int(c), "conf": round(float(s), 4),
                        "x1": x1 / w, "y1": y1 / h, "x2": x2 / w, "y2": y2 / h})
        return out

    def warm(self, model_row):
        """Load the model and run one dummy inference so the first real trigger is not slow."""
        import numpy as np
        try:
            self.predict(model_row, np.zeros((480, 640, 3), np.uint8))
        except Exception as e:
            log.warning("warm-up v%s failed: %s", model_row.get("version"), e)

    def warm_project(self, pid):
        if not pid:
            return
        for st in ("live", "shadow"):
            m = stage_model(pid, st)
            if m:
                threading.Thread(target=self.warm, args=(m,), daemon=True).start()

    def sam_box(self, img, x, y):
        """Click point (normalized) -> bounding box of the segmented region (normalized)."""
        from ultralytics import SAM
        if self.device is None:
            self.device = _device()
        h, w = img.shape[:2]
        with self.lock:
            if self.sam is None:
                from .training import resolve_base_model
                self.sam = SAM(resolve_base_model(SETTINGS["sam"]["model"]))
            r = self.sam.predict(img, points=[[x * w, y * h]], labels=[1], device=self.device, verbose=False)[0]
        if r.masks is None or not len(r.masks):
            return None
        m = r.masks.data[0].cpu().numpy() > 0.5
        ys, xs = m.nonzero()
        if not len(xs):
            return None
        mh, mw = m.shape
        return {"x1": xs.min() / mw, "y1": ys.min() / mh, "x2": (xs.max() + 1) / mw, "y2": (ys.max() + 1) / mh}


CACHE = ModelCache()


def stage_model(pid, stage):
    return db.q1("SELECT * FROM models WHERE project_id=? AND stage=? AND status='done' ORDER BY id DESC LIMIT 1",
                 (pid, stage))


def thresholds(model_row):
    """-> function cls -> threshold (per-class value if set, else the model's threshold)."""
    base = model_row["threshold"] if model_row["threshold"] is not None else SETTINGS["runtime"]["default_threshold"]
    per = json.loads(model_row.get("class_thresholds") or "{}")
    return lambda c: float(per.get(str(c), base))


def hits_of(dets, model_row):
    thr = thresholds(model_row)
    return [d for d in dets if d["conf"] >= thr(d["cls"])]


def verdict(dets, model_row, classes):
    hits = hits_of(dets, model_row)
    names = sorted({classes[d["cls"]] for d in hits if d["cls"] < len(classes)})
    score = max([d["conf"] for d in dets], default=0.0)
    return ("NG" if hits else "OK"), score, names


class Runtime:
    def __init__(self, camera, plc_link):
        self.camera = camera
        self.plc = plc_link
        self.lock = threading.Lock()
        self.last = None
        self.last_jpg = None     # frame of the last inspection, for the line monitor screen
        self.seq = 0

    def _remember(self, frame, info):
        self.seq += 1
        if frame is not None:
            s = 1280 / max(frame.shape[1], 1)
            f = cv2.resize(frame, (1280, int(frame.shape[0] * s)), interpolation=cv2.INTER_AREA) if s < 1 else frame
            ok, jpg = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 85])
            self.last_jpg = jpg.tobytes() if ok else None
        else:
            self.last_jpg = None
        self.last = dict(info, seq=self.seq)
        return self.last

    # settings kept in kv so they survive restarts
    @property
    def project_id(self):
        return db.kv_get("runtime_project")

    @property
    def auto_capture(self):
        return db.kv_get("auto_capture", {"project_id": None, "enabled": False})

    def on_trigger(self, t):
        ac = self.auto_capture
        pid = self.project_id
        frame = self.camera.frame_after(t, timeout=1.0)
        res = None
        if pid:
            res = self.inspect(pid, frame, t)
        if ac.get("enabled") and ac.get("project_id") and frame is not None:
            iid, _ = save_image(ac["project_id"], frame, source="trigger")
            if res is None:     # capture only (no model on the line yet)
                self._remember(frame, {"project_id": ac["project_id"], "ts": t, "mode": "capture", "image_id": iid})
        return res

    def inspect(self, pid, frame, t=None):
        t = t or time.time()
        p = db.get_project(pid)
        live, shadow = stage_model(pid, "live"), stage_model(pid, "shadow")
        if not live and not shadow:
            return None
        if frame is None:
            if live:
                self.plc.send([self.plc.cfg["error_code"]])
            db.ex("INSERT INTO inspections(project_id, ts, live_model, live_verdict, codes) VALUES(?,?,?,?,?)",
                  (pid, t, live and live["id"], "ERROR", json.dumps([self.plc.cfg["error_code"]])))
            return self._remember(None, {"project_id": pid, "ts": t, "mode": "inspect", "error": "no frame",
                                         "live_verdict": "ERROR", "codes": json.dumps([self.plc.cfg["error_code"]])})
        rt = SETTINGS["runtime"]
        row = {"project_id": pid, "ts": t}
        codes = []
        lv = sv = None
        live_hits = shadow_hits = []
        if live:
            dets = CACHE.predict(live, frame)
            lv = verdict(dets, live, p["classes"])
            live_hits = hits_of(dets, live)
            codes = self.plc.codes_for(lv[2], p["classes"])
            self.plc.send(codes)
            row.update(live_model=live["id"], live_verdict=lv[0], live_score=lv[1], live_classes=json.dumps(lv[2]))
        if shadow:
            sd = CACHE.predict(shadow, frame)
            sv = verdict(sd, shadow, p["classes"])
            shadow_hits = hits_of(sd, shadow)
            row.update(shadow_model=shadow["id"], shadow_verdict=sv[0], shadow_score=sv[1],
                       shadow_classes=json.dumps(sv[2]))
        row["ms"] = round((time.time() - t) * 1000, 1)
        row["codes"] = json.dumps(codes)
        disagree = lv and sv and lv[0] != sv[0]
        ng = (lv and lv[0] == "NG") or (sv and sv[0] == "NG")
        if (ng and rt["save_ng_images"]) or disagree:
            d = db.project_dir(pid) / "inspections" / time.strftime("%Y%m%d", time.localtime(t))
            d.mkdir(parents=True, exist_ok=True)
            path = d / f"{time.strftime('%H%M%S', time.localtime(t))}_{int(t * 1000) % 1000:03d}.jpg"
            cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            row["image_path"] = str(path)
        cols = ",".join(row)
        iid = db.ex(f"INSERT INTO inspections({cols}) VALUES({','.join('?' * len(row))})", tuple(row.values()))
        # uncertain -> review queue (decided by the model that drives the line, else the shadow)
        ref = lv or sv
        if ref and rt["review_low"] <= ref[1] <= rt["review_high"]:
            save_image(pid, frame, source="review", status="review", score=ref[1])
        return self._remember(frame, dict(row, id=iid, mode="inspect", disagree=bool(disagree),
                                          live_dets=live_hits, shadow_dets=shadow_hits,
                                          live_version=live and live["version"],
                                          shadow_version=shadow and shadow["version"]))

    def stats(self, pid):
        live, shadow = stage_model(pid, "live"), stage_model(pid, "shadow")
        out = {"live": live and _brief(live), "shadow": shadow and _brief(shadow), "enabled": self.project_id == pid,
               "last": self.last if self.last and self.last.get("project_id") == pid else None}
        if shadow:
            since = shadow["deployed"] or 0
            r = db.q1("SELECT COUNT(*) n, MIN(ts) t0, "
                      "SUM(CASE WHEN live_verdict IS NOT NULL AND live_verdict!=shadow_verdict THEN 1 ELSE 0 END) diff, "
                      "SUM(CASE WHEN shadow_verdict='NG' AND live_verdict='OK' THEN 1 ELSE 0 END) more_ng, "
                      "SUM(CASE WHEN shadow_verdict='OK' AND live_verdict='NG' THEN 1 ELSE 0 END) less_ng "
                      "FROM inspections WHERE project_id=? AND shadow_model=? AND ts>=?", (pid, shadow["id"], since))
            out["shadow_stats"] = {"n": r["n"] or 0, "diff": r["diff"] or 0, "more_ng": r["more_ng"] or 0,
                                   "less_ng": r["less_ng"] or 0, "hours": round((time.time() - since) / 3600, 1)}
        day = db.q1("SELECT COUNT(*) n, SUM(CASE WHEN live_verdict='NG' THEN 1 ELSE 0 END) ng, AVG(ms) ms "
                    "FROM inspections WHERE project_id=? AND ts>=?", (pid, time.time() - 86400))
        out["today"] = {"n": day["n"] or 0, "ng": day["ng"] or 0, "ms": round(day["ms"] or 0, 1)}
        return out


def _brief(m):
    return {"id": m["id"], "version": m["version"], "threshold": m["threshold"], "deployed": m["deployed"],
            "class_thresholds": json.loads(m.get("class_thresholds") or "{}")}


def draw_dets(frame, dets, classes):
    """Boxes on a frame for the live stream overlay (cv2 cannot draw Thai: non-ASCII names -> #index)."""
    h, w = frame.shape[:2]
    for d in dets:
        name = classes[d["cls"]] if d["cls"] < len(classes) else str(d["cls"])
        if not name.isascii():
            name = f"#{d['cls'] + 1}"
        p1 = (int(d["x1"] * w), int(d["y1"] * h)); p2 = (int(d["x2"] * w), int(d["y2"] * h))
        cv2.rectangle(frame, p1, p2, (0, 0, 255), 3)
        txt = f"{name} {d['conf']:.2f}"
        (tw, th), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
        y = max(p1[1], th + 8)
        cv2.rectangle(frame, (p1[0], y - th - 8), (p1[0] + tw + 8, y), (0, 0, 255), -1)
        cv2.putText(frame, txt, (p1[0] + 4, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    return frame
