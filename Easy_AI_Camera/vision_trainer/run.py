"""Start Vision Trainer:  python run.py  [--settings other.json]  ->  http://localhost:8600"""
import argparse
import os
import sys

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--settings", help="settings file (default: settings.json)")
    ap.add_argument("--camera", choices=["daheng", "uvc", "sim"], help="override camera.type for this run")
    a = ap.parse_args()
    if a.settings:
        os.environ["VT_SETTINGS"] = os.path.abspath(a.settings)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from app.config import SETTINGS
    if a.camera:
        SETTINGS["camera"]["type"] = a.camera
    import uvicorn
    from app.main import app
    print(f"Vision Trainer -> http://localhost:{SETTINGS['server']['port']}   (camera: {SETTINGS['camera']['type']})")
    uvicorn.run(app, host=SETTINGS["server"]["host"], port=SETTINGS["server"]["port"], log_level="warning")
