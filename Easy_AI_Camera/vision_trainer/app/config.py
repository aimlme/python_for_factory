"""Settings: settings.json next to the project root, merged over built-in defaults."""
import copy
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DEFAULTS = {
    "server": {"host": "0.0.0.0", "port": 8600},
    "data_dir": "data",
    "camera": {
        "type": "daheng",          # daheng | uvc | sim
        "enabled": True,
        "sn": "",
        "exposure_us": 5000,
        "gain_db": 0,
        "rotate": 0,               # 0 / 90 / 180 / 270
        "uvc": {"index": 0, "width": 1280, "height": 960, "fps": 30, "backend": "dshow", "exposure": None},
    },
    "plc": {
        "enabled": True,
        "listen_ip": "0.0.0.0",
        "trigger_port": 8500,
        "trigger_command": "COMMAND1",
        "plc_ip": "127.0.0.1",
        "result_port": 4096,
        "ok_code": "OKOK",
        "ng_general_code": "AL01",
        "error_code": "ER01",
        "heartbeat_code": "HB01",
        "heartbeat_s": 0,
        "defect_codes": {},
    },
    "capture": {"jpeg_quality": 95, "target_ok": 100, "target_per_class": 50, "min_per_class": 30},
    "training": {
        "device": "auto",
        "val_ratio": 0.2,
        "workers": 2,
        "export_onnx": True,
        "amp": True,              # fp16 mixed precision; set false if cuDNN errors on this GPU
        # Ultralytics augmentation, tuned for a fixed camera over a press line (see README)
        "augment": {
            "hsv_v": 0.4,       # brightness ±40% — lighting changes
            "hsv_h": 0.0,       # hue / saturation: no use on mono cameras
            "hsv_s": 0.0,
            "degrees": 0.0,     # rotation ± degrees (try 5 if parts sit slightly rotated)
            "translate": 0.1,   # shift ±10%
            "scale": 0.25,      # zoom ±25% (Ultralytics default 0.5 can shrink thin cracks away)
            "fliplr": 0.5,      # left-right flip probability
            "flipud": 0.5,      # up-down flip probability (cracks have no direction)
            "mosaic": 1.0,      # 4-image mosaic probability (switched off for the last 10 epochs)
            "mixup": 0.0,
        },
        "presets": {
            "fast": {"model": "yolo26n.pt", "epochs": 50, "imgsz": 640, "patience": 15, "batch": 16},
            "accurate": {"model": "yolo26m.pt", "epochs": 150, "imgsz": 1280, "patience": 20, "batch": 8},
        },
    },
    "prelabel": {"conf": 0.25},
    "sam": {"model": "mobile_sam.pt"},
    "runtime": {
        "default_threshold": 0.5,
        "review_low": 0.35,
        "review_high": 0.55,
        "save_ng_images": True,
        "auto_retrain_every": 50,
    },
}


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_settings(path=None):
    path = Path(path or os.environ.get("VT_SETTINGS") or ROOT / "settings.json")
    user = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            user = json.load(f)
    s = _merge(DEFAULTS, user)
    s["_path"] = str(path)
    d = Path(s["data_dir"])
    s["data_dir"] = str(d if d.is_absolute() else ROOT / d)
    if s["camera"]["type"] not in ("daheng", "uvc", "sim"):
        raise ValueError("camera.type must be daheng, uvc or sim")
    return s


SETTINGS = load_settings()
DATA = Path(SETTINGS["data_dir"])
DATA.mkdir(parents=True, exist_ok=True)
