"""Image storage helpers: save, near-duplicate check (dHash), thumbnails, annotations."""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

from . import db
from .config import SETTINGS


def is_duplicate(pid, key) -> bool:
    """Exact duplicates only (same file uploaded twice, same camera frame saved twice).
    Parts on a press line all look alike, so a similarity check would throw away real new parts."""
    return bool(key) and db.q1("SELECT 1 FROM images WHERE project_id=? AND dhash=?", (pid, key)) is not None


def content_key(data: bytes) -> str:
    return "md5:" + hashlib.md5(data).hexdigest()


def decode(data: bytes):
    arr = np.frombuffer(data, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def save_image(pid, img_bgr, source="upload", status="unlabeled", key=None, score=None, lot=""):
    """key: dedupe key (content_key of the upload, camera frame time). Returns (image_id or None, duplicate)."""
    h = key
    if is_duplicate(pid, h):
        return None, True
    d = db.project_dir(pid)
    iid = db.ex("INSERT INTO images(project_id, filename, w, h, source, status, dhash, score, lot, created) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (pid, "", img_bgr.shape[1], img_bgr.shape[0], source, status, h, score, lot, db.now()))
    name = f"{iid:07d}.jpg"
    cv2.imwrite(str(d / "images" / name), img_bgr, [cv2.IMWRITE_JPEG_QUALITY, SETTINGS["capture"]["jpeg_quality"]])
    db.ex("UPDATE images SET filename=? WHERE id=?", (name, iid))
    return iid, False


def image_path(img) -> Path:
    return db.project_dir(img["project_id"]) / "images" / img["filename"]


def thumb_path(img, width=320) -> Path:
    t = db.project_dir(img["project_id"]) / "thumbs" / img["filename"]
    if not t.exists():
        im = cv2.imread(str(image_path(img)))
        if im is None:
            return image_path(img)
        s = width / im.shape[1]
        im = cv2.resize(im, (width, max(1, int(im.shape[0] * s))), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(t), im, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return t


def get_image(iid):
    img = db.q1("SELECT * FROM images WHERE id=?", (iid,))
    if img:
        img["boxes"] = db.q("SELECT * FROM boxes WHERE image_id=? ORDER BY id", (iid,))
    return img


def set_annotation(iid, boxes, ok=False):
    """boxes: list of dicts cls,x1,y1,x2,y2[,origin,conf,confirmed]. Status follows the content."""
    clean = []
    for b in boxes or []:
        x1, x2 = sorted((float(b["x1"]), float(b["x2"])))
        y1, y2 = sorted((float(b["y1"]), float(b["y2"])))
        x1, y1, x2, y2 = [min(1.0, max(0.0, v)) for v in (x1, y1, x2, y2)]
        if x2 - x1 < 1e-4 or y2 - y1 < 1e-4:
            continue
        clean.append((int(b["cls"]), x1, y1, x2, y2, b.get("origin", "human"), b.get("conf"),
                      1 if b.get("confirmed", True) else 0))
    if ok:
        clean = []
    pending = any(c[7] == 0 for c in clean)
    status = "labeled" if (ok or (clean and not pending)) else "unlabeled"

    def fn(c):
        c.execute("DELETE FROM boxes WHERE image_id=?", (iid,))
        c.executemany("INSERT INTO boxes(image_id, cls, x1, y1, x2, y2, origin, conf, confirmed) "
                      "VALUES(?,?,?,?,?,?,?,?,?)", [(iid,) + t for t in clean])
        c.execute("UPDATE images SET status=? WHERE id=?", (status, iid))
    db.tx(fn)
    return get_image(iid)


def delete_image(iid):
    img = db.q1("SELECT * FROM images WHERE id=?", (iid,))
    if not img:
        return
    for p in (image_path(img), db.project_dir(img["project_id"]) / "thumbs" / img["filename"]):
        try:
            p.unlink()
        except FileNotFoundError:
            pass
    db.tx(lambda c: (c.execute("DELETE FROM boxes WHERE image_id=?", (iid,)),
                     c.execute("DELETE FROM images WHERE id=?", (iid,))))


def summary(pid):
    """Counts for the capture screen: per-class image counts, OK images, warnings."""
    p = db.get_project(pid)
    cap = SETTINGS["capture"]
    total = db.q1("SELECT COUNT(*) n FROM images WHERE project_id=?", (pid,))["n"]
    by_status = {r["status"]: r["n"] for r in
                 db.q("SELECT status, COUNT(*) n FROM images WHERE project_id=? GROUP BY status", (pid,))}
    ok = db.q1("SELECT COUNT(*) n FROM images i WHERE project_id=? AND status='labeled' AND "
               "NOT EXISTS (SELECT 1 FROM boxes b WHERE b.image_id=i.id)", (pid,))["n"]
    per = {r["cls"]: r["n"] for r in db.q(
        "SELECT b.cls, COUNT(DISTINCT b.image_id) n FROM boxes b JOIN images i ON i.id=b.image_id "
        "WHERE i.project_id=? AND i.status='labeled' GROUP BY b.cls", (pid,))}
    small = db.q1("SELECT MIN((b.x2-b.x1)*i.w) mw, MIN((b.y2-b.y1)*i.h) mh FROM boxes b JOIN images i "
                  "ON i.id=b.image_id WHERE i.project_id=? AND i.status='labeled'", (pid,))
    rows = [{"name": "ชิ้นงานดี (ไม่มีกรอบ)", "cls": None, "n": ok, "target": cap["target_ok"]}]
    for i, name in enumerate(p["classes"]):
        rows.append({"name": name, "cls": i, "n": per.get(i, 0), "target": cap["target_per_class"]})
    warnings = []
    for r in rows[1:]:
        if r["n"] < cap["min_per_class"]:
            warnings.append(f"{r['name']} มี {r['n']} ภาพ ต่ำกว่าที่แนะนำ ({cap['min_per_class']}) — "
                            f"ต้องการอีก {cap['min_per_class'] - r['n']} ภาพ")
    defect_counts = [r["n"] for r in rows[1:] if r["n"] > 0]
    if defect_counts and ok > 0 and ok / min(defect_counts) > 5:
        warnings.append(f"ชิ้นงานดีมากกว่า class ที่น้อยที่สุด {ok / min(defect_counts):.0f} เท่า (class ไม่สมดุล)")
    return {
        "total": total,
        "labeled": by_status.get("labeled", 0),
        "unlabeled": by_status.get("unlabeled", 0),
        "review": by_status.get("review", 0),
        "rows": rows,
        "warnings": warnings,
        "min_box_px": round(min(small["mw"], small["mh"]), 1) if small and small["mw"] is not None else None,
    }


def yolo_label_lines(boxes):
    out = []
    for b in boxes:
        if not b["confirmed"]:
            continue
        cx, cy = (b["x1"] + b["x2"]) / 2, (b["y1"] + b["y2"]) / 2
        w, h = b["x2"] - b["x1"], b["y2"] - b["y1"]
        out.append(f"{b['cls']} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return out


def dumps(x):
    return json.dumps(x, ensure_ascii=False)
