"""
Cameras: Daheng (gxipy from the Galaxy SDK), UVC webcam (OpenCV) and a simulated camera.

All cameras run continuous acquisition in a background thread. A PLC trigger takes the
first frame that arrives AFTER the trigger time (never a stale buffered frame), the same
rule as the stamp_inspection detector.

gxipy: copy the folder from
  C:\\Program Files\\Daheng Imaging\\GalaxySDK\\Development\\Samples\\Python\\gxipy
next to this project (vision_trainer/gxipy). The PyPI package may not match your SDK.
"""
import logging
import sys
import threading
import time
import types
from pathlib import Path

import cv2
import numpy as np

from .config import ROOT

log = logging.getLogger("camera")


def _import_gxipy():
    # gxipy imports numpy.compat.long, removed in numpy >= 2.x; long == int on Python 3
    if "numpy.compat" not in sys.modules:
        try:
            import numpy.compat  # noqa: F401
        except Exception:
            m = types.ModuleType("numpy.compat")
            m.long = int
            sys.modules["numpy.compat"] = m
            np.compat = m
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    import gxipy as gx  # noqa
    return gx


_ROT = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}


def _rotate(img, deg):
    return cv2.rotate(img, _ROT[deg]) if deg in _ROT else img


class DahengCamera:
    def __init__(self, cfg):
        gx = self.gx = _import_gxipy()
        self.dm = gx.DeviceManager()
        n, info = (self.dm.update_all_device_list() if hasattr(self.dm, "update_all_device_list")
                   else self.dm.update_device_list())
        if n == 0:
            raise RuntimeError("ไม่พบกล้อง Daheng (ตรวจสาย USB3 / ปิด Galaxy Viewer ก่อน)")
        sn = cfg.get("sn")
        self.cam = self.dm.open_device_by_sn(sn) if sn else self.dm.open_device_by_index(1)
        self.sn = sn or (info[0].get("sn") if info else "")
        self.model = (info[0].get("model_name") if info else "Daheng")
        self.is_color = False
        try:
            fc = self.cam.get_remote_device_feature_control()
            self._set_enum(fc, "TriggerMode", "Off")
            self._set_enum(fc, "ExposureAuto", "Off")
            self._set_float(fc, "ExposureTime", float(cfg.get("exposure_us", 5000)))
            self._set_float(fc, "Gain", float(cfg.get("gain_db", 0)))
            try:
                pf = fc.get_enum_feature("PixelFormat").get()
                self.is_color = "bayer" in str(pf[1] if isinstance(pf, tuple) else pf).lower()
            except Exception:
                pass
        except AttributeError:      # older gxipy (attribute-style features)
            self.cam.TriggerMode.set(gx.GxSwitchEntry.OFF)
            self.cam.ExposureTime.set(float(cfg.get("exposure_us", 5000)))
            if self.cam.Gain.is_implemented():
                self.cam.Gain.set(float(cfg.get("gain_db", 0)))
            self.is_color = self.cam.PixelColorFilter.is_implemented() and \
                self.cam.PixelColorFilter.get()[0] != gx.GxPixelColorFilterEntry.NONE
        self.cam.stream_on()

    @staticmethod
    def _set_enum(fc, name, value):
        try:
            fc.get_enum_feature(name).set(value)
        except Exception as e:
            log.debug("Daheng %s=%s not set: %s", name, value, e)

    @staticmethod
    def _set_float(fc, name, value):
        try:
            fc.get_float_feature(name).set(value)
        except Exception as e:
            log.debug("Daheng %s=%s not set: %s", name, value, e)

    def read(self):
        raw = self.cam.data_stream[0].get_image(timeout=1000)
        if raw is None:
            return None
        try:
            if raw.get_status() != 0:   # GX_FRAME_STATUS_SUCCESS
                return None
        except Exception:
            pass
        if self.is_color:
            rgb = raw.convert("RGB")
            arr = rgb.get_numpy_array() if rgb is not None else None
            return None if arr is None else cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        arr = raw.get_numpy_array()
        return None if arr is None else cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)

    def describe(self):
        return f"Daheng {self.model} SN={self.sn} ({'color' if self.is_color else 'mono'})"

    def close(self):
        for fn in (self.cam.stream_off, self.cam.close_device):
            try:
                fn()
            except Exception:
                pass


class UvcCamera:
    def __init__(self, cfg):
        u = cfg.get("uvc", {})
        backend = {"dshow": cv2.CAP_DSHOW, "msmf": cv2.CAP_MSMF, "v4l2": cv2.CAP_V4L2}.get(u.get("backend"), cv2.CAP_ANY)
        self.cap = cv2.VideoCapture(int(u.get("index", 0)), backend)
        if not self.cap.isOpened():
            raise RuntimeError(f"เปิด webcam index {u.get('index', 0)} ไม่ได้ (ลอง backend msmf หรือ index อื่น)")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, u.get("width", 1280))
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, u.get("height", 960))
        self.cap.set(cv2.CAP_PROP_FPS, u.get("fps", 30))
        if u.get("exposure") is not None:
            self.cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)
            self.cap.set(cv2.CAP_PROP_EXPOSURE, float(u["exposure"]))
        self.index = u.get("index", 0)

    def read(self):
        ok, f = self.cap.read()
        return f if ok else None

    def describe(self):
        w, h = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        return f"UVC webcam #{self.index} {w}x{h}"

    def close(self):
        self.cap.release()


class SimCamera:
    """Synthetic stamped bracket with a random crack now and then — for testing without hardware."""

    def __init__(self, cfg):
        self.n = 0
        self.rng = np.random.default_rng(1)

    def read(self):
        time.sleep(1 / 15)
        self.n += 1
        rng = self.rng
        img = np.full((480, 640, 3), 70, np.uint8)
        dx, dy = int(rng.integers(-12, 12)), int(rng.integers(-8, 8))
        pts = np.array([[90, 400], [90, 130], [130, 90], [510, 90], [550, 130], [550, 400], [460, 400],
                        [460, 200], [180, 200], [180, 400]]) + [dx, dy]
        cv2.fillPoly(img, [pts.astype(np.int32)], (150, 152, 156))
        cv2.circle(img, (320 + dx, 140 + dy), 18, (70, 70, 70), -1)
        img = cv2.add(img, rng.integers(0, 12, img.shape, dtype=np.uint8))
        if rng.random() < 0.4:      # crack near the corner radius
            x, y = 110 + dx + int(rng.integers(0, 30)), 115 + dy + int(rng.integers(0, 30))
            p = [(x, y)]
            for _ in range(5):
                x += int(rng.integers(3, 9)); y += int(rng.integers(2, 9)); p.append((x, y))
            cv2.polylines(img, [np.array(p, np.int32)], False, (40, 40, 40), 2)
        cv2.putText(img, f"SIM #{self.n}", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (220, 220, 220), 1)
        return img

    def describe(self):
        return "Simulated camera (ไม่มีฮาร์ดแวร์)"

    def close(self):
        pass


def open_camera(cfg):
    t = cfg["type"]
    return {"daheng": DahengCamera, "uvc": UvcCamera, "sim": SimCamera}[t](cfg)


class CameraService:
    """Background acquisition; latest frame + 'first frame after time t'."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.cam = None
        self.thread = None
        self.running = False
        self.error = None
        self.info = ""
        self.frame = None
        self.frame_t = 0.0
        self.fps = 0.0
        self.cond = threading.Condition()

    def start(self):
        if self.running:
            return
        self.error = None
        try:
            self.cam = open_camera(self.cfg)
            self.info = self.cam.describe()
        except Exception as e:
            self.error = f"{type(e).__name__}: {e}"
            log.error("camera open failed: %s", self.error)
            self.cam = None
            return
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True, name="camera")
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=3)
        if self.cam:
            self.cam.close()
        self.cam = None

    def _loop(self):
        last = time.time(); n = 0; fails = 0
        rot = int(self.cfg.get("rotate", 0) or 0)
        while self.running:
            try:
                f = self.cam.read()
            except Exception as e:
                f = None
                self.error = f"{type(e).__name__}: {e}"
            if f is None:
                fails += 1
                if fails > 50:
                    self.error = self.error or "กล้องไม่ส่งภาพ"
                time.sleep(0.01)
                continue
            fails = 0
            self.error = None
            if rot:
                f = _rotate(f, rot)
            with self.cond:
                self.frame, self.frame_t = f, time.time()
                self.cond.notify_all()
            n += 1
            if time.time() - last >= 1:
                self.fps, n, last = n / (time.time() - last), 0, time.time()

    def latest(self):
        with self.cond:
            return None if self.frame is None else self.frame.copy()

    def frame_after(self, t, timeout=1.0):
        end = time.time() + timeout
        with self.cond:
            while self.frame_t <= t:
                left = end - time.time()
                if left <= 0 or not self.running:
                    return None
                self.cond.wait(left)
            return self.frame.copy()

    def status(self):
        return {"running": self.running, "type": self.cfg["type"], "info": self.info,
                "error": self.error, "fps": round(self.fps, 1),
                "size": None if self.frame is None else [self.frame.shape[1], self.frame.shape[0]]}
