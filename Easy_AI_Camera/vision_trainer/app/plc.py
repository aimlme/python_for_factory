"""
UDP link with the PLC — same protocol as stamp_inspection:

  PLC      -- "COMMAND1\\r\\n"                   --> this server (plc.trigger_port)
  server   -- "OKOK" | "AL05","AL01" | "ER01"   --> PLC (plc.plc_ip : plc.result_port)
  server   -- "HB01" every heartbeat_s          --> PLC (optional)
"""
import logging
import socket
import threading
import time

log = logging.getLogger("plc")


class PlcLink:
    def __init__(self, cfg, on_trigger):
        self.cfg = cfg
        self.on_trigger = on_trigger        # callable(trigger_time)
        self.running = False
        self.sock_rx = None
        self.sock_tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.error = None
        self.triggers = 0
        self.last_trigger = None
        self.last_codes = []
        self.last_sent = None

    def start(self):
        if not self.cfg.get("enabled", True) or self.running:
            return
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((self.cfg["listen_ip"], int(self.cfg["trigger_port"])))
            s.settimeout(0.5)
            self.sock_rx = s
        except OSError as e:
            self.error = f"bind {self.cfg['listen_ip']}:{self.cfg['trigger_port']} ไม่ได้: {e}"
            log.error(self.error)
            return
        self.running = True
        threading.Thread(target=self._rx, daemon=True, name="plc-rx").start()
        if float(self.cfg.get("heartbeat_s") or 0) > 0:
            threading.Thread(target=self._hb, daemon=True, name="plc-hb").start()

    def stop(self):
        self.running = False
        if self.sock_rx:
            self.sock_rx.close()

    def _rx(self):
        cmd = self.cfg["trigger_command"].encode()
        while self.running:
            try:
                data, addr = self.sock_rx.recvfrom(1024)
            except socket.timeout:
                continue
            except OSError:
                break
            if data.strip() != cmd:
                log.debug("ignored %r from %s", data, addr)
                continue
            t = time.time()
            self.triggers += 1
            self.last_trigger = t
            threading.Thread(target=self._safe_trigger, args=(t,), daemon=True).start()

    def _safe_trigger(self, t):
        try:
            self.on_trigger(t)
        except Exception:
            log.exception("trigger handler failed")

    def _hb(self):
        while self.running:
            self.send([self.cfg["heartbeat_code"]], log_it=False)
            time.sleep(float(self.cfg["heartbeat_s"]))

    def send(self, codes, log_it=True):
        addr = (self.cfg["plc_ip"], int(self.cfg["result_port"]))
        for c in codes:
            try:
                self.sock_tx.sendto(c.encode(), addr)
            except OSError as e:
                self.error = f"ส่งผลไป PLC {addr} ไม่ได้: {e}"
        if log_it:
            self.last_codes, self.last_sent = list(codes), time.time()

    def codes_for(self, defect_names, classes):
        """['crack'] -> ['AL05','AL01']; [] -> ['OKOK']. Unknown class -> AL01 only."""
        if not defect_names:
            return [self.cfg["ok_code"]]
        out = []
        for name in sorted(set(defect_names), key=lambda n: classes.index(n) if n in classes else 99):
            code = self.cfg.get("defect_codes", {}).get(name)
            out += ([code] if code else []) + [self.cfg["ng_general_code"]]
        return out

    def status(self):
        return {"enabled": self.cfg.get("enabled", True), "running": self.running, "error": self.error,
                "listen": f"{self.cfg['listen_ip']}:{self.cfg['trigger_port']}",
                "plc": f"{self.cfg['plc_ip']}:{self.cfg['result_port']}",
                "trigger_command": self.cfg["trigger_command"], "triggers": self.triggers,
                "last_trigger": self.last_trigger, "last_codes": self.last_codes, "last_sent": self.last_sent,
                "defect_codes": self.cfg.get("defect_codes", {})}
