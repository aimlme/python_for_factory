"""
Minimal PLC simulator (console). Sends COMMAND1 and prints the result codes.

  python tools/plc_sim.py                 # Enter = one trigger
  python tools/plc_sim.py --auto 2        # one trigger every 2 s

Set plc.plc_ip in settings.json to 127.0.0.1 while testing on one PC.
plc_simulator_gui.py from stamp_inspection also works (same protocol and ports).
"""
import argparse
import json
import socket
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ap = argparse.ArgumentParser()
ap.add_argument("--auto", type=float, default=0, help="seconds between triggers (0 = press Enter)")
a = ap.parse_args()
cfg = json.loads((ROOT / "settings.json").read_text(encoding="utf-8"))["plc"]
target = ("127.0.0.1" if cfg["listen_ip"] in ("0.0.0.0", "") else cfg["listen_ip"], int(cfg["trigger_port"]))

rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
rx.bind(("0.0.0.0", int(cfg["result_port"])))
tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sent = {"t": None, "n": 0}


def listen():
    while True:
        data, _ = rx.recvfrom(64)
        code = data.decode(errors="replace").strip()
        dt = f"{(time.time() - sent['t']) * 1000:.0f} ms" if sent["t"] else ""
        print(f"   <- {code}  {dt}")


threading.Thread(target=listen, daemon=True).start()
print(f"sending {cfg['trigger_command']} to {target[0]}:{target[1]}, listening on :{cfg['result_port']}")
while True:
    if a.auto:
        time.sleep(a.auto)
    else:
        input()
    sent["n"] += 1
    sent["t"] = time.time()
    tx.sendto((cfg["trigger_command"] + "\r\n").encode(), target)
    print(f"#{sent['n']} -> {cfg['trigger_command']}")
