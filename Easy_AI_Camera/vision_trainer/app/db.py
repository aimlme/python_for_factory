"""SQLite storage (one file: data/vision_trainer.db). Thread-safe through one lock."""
import json
import sqlite3
import threading
import time
from pathlib import Path

from .config import DATA

DB_PATH = DATA / "vision_trainer.db"
_lock = threading.RLock()
_conn = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    station TEXT DEFAULT '',
    classes TEXT NOT NULL,              -- JSON list of class names (index = YOLO class id)
    auto_retrain INTEGER DEFAULT 1,
    reviewed_since_train INTEGER DEFAULT 0,
    last_preset TEXT DEFAULT 'fast',
    created REAL
);
CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    w INTEGER, h INTEGER,
    source TEXT DEFAULT 'upload',       -- upload | camera | trigger | review
    status TEXT DEFAULT 'unlabeled',    -- unlabeled | labeled | review
    dhash TEXT,
    score REAL,                         -- model score when it came from the line (review queue)
    lot TEXT DEFAULT '',
    created REAL
);
CREATE INDEX IF NOT EXISTS ix_images_project ON images(project_id, status);
CREATE TABLE IF NOT EXISTS boxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id INTEGER NOT NULL,
    cls INTEGER NOT NULL,
    x1 REAL, y1 REAL, x2 REAL, y2 REAL, -- normalized 0..1
    origin TEXT DEFAULT 'human',        -- human | ai
    conf REAL,
    confirmed INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_boxes_image ON boxes(image_id);
CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    preset TEXT,
    params TEXT,                        -- JSON train params
    status TEXT DEFAULT 'queued',       -- queued | training | done | failed | cancelled
    stage TEXT DEFAULT 'none',          -- none | shadow | live | archived
    threshold REAL,
    class_thresholds TEXT,              -- JSON {"<cls>": thr}; missing class -> threshold
    weights TEXT, onnx TEXT,
    metrics TEXT,                       -- JSON
    eval TEXT,                          -- JSON per-image scores on val set
    error TEXT,
    n_images INTEGER,
    created REAL, finished REAL, deployed REAL
);
CREATE TABLE IF NOT EXISTS inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    ts REAL,
    live_model INTEGER, live_verdict TEXT, live_score REAL, live_classes TEXT,
    shadow_model INTEGER, shadow_verdict TEXT, shadow_score REAL, shadow_classes TEXT,
    codes TEXT,
    image_path TEXT,
    ms REAL
);
CREATE INDEX IF NOT EXISTS ix_insp ON inspections(project_id, ts);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
"""


def conn():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(SCHEMA)
        cols = {r[1] for r in _conn.execute("PRAGMA table_info(models)").fetchall()}
        if "class_thresholds" not in cols:      # databases created before per-class thresholds
            _conn.execute("ALTER TABLE models ADD COLUMN class_thresholds TEXT")
    return _conn


def q(sql, args=()):
    with _lock:
        return [dict(r) for r in conn().execute(sql, args).fetchall()]


def q1(sql, args=()):
    rows = q(sql, args)
    return rows[0] if rows else None


def ex(sql, args=()):
    with _lock:
        cur = conn().execute(sql, args)
        return cur.lastrowid


def tx(fn):
    """Run fn(connection) in one transaction."""
    with _lock:
        c = conn()
        c.execute("BEGIN")
        try:
            out = fn(c)
            c.execute("COMMIT")
            return out
        except Exception:
            c.execute("ROLLBACK")
            raise


def kv_get(k, default=None):
    r = q1("SELECT v FROM kv WHERE k=?", (k,))
    return json.loads(r["v"]) if r else default


def kv_set(k, v):
    ex("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))


def now():
    return time.time()


def project_dir(pid) -> Path:
    d = DATA / "projects" / str(pid)
    for sub in ("images", "thumbs", "datasets", "runs", "inspections"):
        (d / sub).mkdir(parents=True, exist_ok=True)
    return d


def get_project(pid):
    p = q1("SELECT * FROM projects WHERE id=?", (pid,))
    if p:
        p["classes"] = json.loads(p["classes"])
    return p
