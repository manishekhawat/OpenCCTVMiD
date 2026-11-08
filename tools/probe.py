#!/usr/bin/env python3
"""Probe a Dafang (isa.camera.df3) for the miIO methods its firmware answers.

python-miio has no driver for this camera and the PTZ methods were never
documented, so the only honest way to find out what firmware 5.5.1_1025
supports is to ask it. The device replies:

    ok / a value     -> the method exists and we called it correctly
    unsupported_method / -32601 -> the method does not exist
    invalid params / -32602     -> the method EXISTS, our arguments were wrong
    (timeout)                   -> no answer; usually also "doesn't exist"

The -32602 case is the interesting one: it proves a method name is real.

Usage:
    python3 probe.py --ip 192.168.1.11 --token <32 hex chars>
    python3 probe.py --discover
    python3 probe.py --ip ... --token ... --call set_video '["on"]'
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from miio import Device, MiioError, discover

# --------------------------------------------------------------------------- #
# Candidate surface
# --------------------------------------------------------------------------- #

# Properties seen on Xiaomi/Chuangmi/Isa camera firmware. Queried one at a
# time, because one bad name in a batch fails the whole get_prop.
PROPS = [
    "power", "video", "light", "led", "night_mode", "nightmode", "ir",
    "full_color", "flip", "rotate", "mirror", "watermark", "wdr", "hdr",
    "motion_record", "motion_detect", "md", "mdsens", "sensitivity",
    "alarm", "alarm_interval", "track", "cruise", "auto_track",
    "sdcard_status", "sd_status", "storage", "free_space", "total_space",
    "rtsp", "resolution", "quality", "bitrate", "volume", "mic", "speaker",
    "motor_x", "motor_y", "pan", "tilt", "preset", "ota_state",
]

# Methods to test for existence. Params are deliberately plausible; a
# -32602 "invalid params" still proves the name is real.
METHODS: list[tuple[str, list]] = [
    # --- identity / safe reads ---
    ("miIO.info", []),
    ("get_prop", ["power"]),
    ("get_properties", [{"did": "x", "siid": 1, "piid": 1}]),
    # --- power / stream ---
    ("set_power", ["on"]),
    ("set_video", ["on"]),
    ("set_light", ["on"]),
    ("set_led", ["on"]),
    ("set_night_mode", [0]),
    ("set_nightmode", [0]),
    ("set_full_color", [0]),
    # --- image ---
    ("set_flip", ["off"]),
    ("set_rotate", [0]),
    ("set_mirror", ["off"]),
    ("set_watermark", ["on"]),
    ("set_wdr", ["on"]),
    ("set_resolution", ["hd"]),
    # --- detection ---
    ("set_motion_record", ["on"]),
    ("set_motion_detect", ["on"]),
    ("set_md", [1]),
    ("set_mdsens", [2]),
    ("set_alarm", ["on"]),
    ("set_alarm_interval", [5]),
    # --- the PTZ hunt: this is what we actually came for ---
    ("set_motor", [{"operation": 0}]),
    ("set_motor", [0]),
    ("motor_move", [{"direction": 0, "steps": 10}]),
    ("set_motor_move", [{"direction": 0, "steps": 10}]),
    ("ptz_move", ["left"]),
    ("set_ptz", ["left"]),
    ("set_pan", [10]),
    ("set_tilt", [10]),
    ("motor_reset", []),
    ("set_motor_reset", []),
    ("get_motor_status", []),
    ("motor_status", []),
    ("set_cruise", ["off"]),
    ("set_track", ["off"]),
    ("set_auto_track", ["off"]),
    ("goto_preset", [1]),
    ("set_preset", [1]),
    ("get_preset", []),
    # --- storage / misc ---
    ("get_sdcard_status", []),
    ("sdcard_format", []),          # listed, never auto-run (see SAFE_ONLY)
    ("get_free_space", []),
    ("set_volume", [50]),
]

# Never fire these during a sweep, even though we want to know they exist.
DESTRUCTIVE = {"sdcard_format", "miIO.ota", "set_wifi", "miIO.config_router"}

UNSUPPORTED = ("unsupported", "-32601", "not supported", "unknown method")
BAD_PARAMS = ("invalid", "-32602", "params")


def classify(err: object) -> str:
    text = json.dumps(err).lower()
    if any(k in text for k in UNSUPPORTED):
        return "absent"
    if any(k in text for k in BAD_PARAMS):
        return "exists"
    return "error"


def probe_props(dev: Device, delay: float) -> dict:
    print("\n== properties ==")
    live = {}
    for name in PROPS:
        try:
            result = dev.get_prop([name])
        except MiioError:
            continue
        except TimeoutError:
            print(f"  {name:<18} timeout")
            continue
        if result and result[0] not in (None, "unsupport", "unsupported"):
            live[name] = result[0]
            print(f"  \033[32m{name:<18}\033[0m {result[0]!r}")
        time.sleep(delay)
    if not live:
        print("  (none answered)")
    return live


def probe_methods(dev: Device, delay: float, unsafe: bool) -> dict:
    print("\n== methods ==")
    verdict: dict[str, str] = {}
    for method, params in METHODS:
        label = f"{method}({json.dumps(params)})"
        if method in DESTRUCTIVE and not unsafe:
            print(f"  {label:<52} skipped (destructive)")
            continue
        try:
            result = dev.send(method, params)
            verdict[method] = "ok"
            print(f"  \033[32m{label:<52} OK\033[0m -> {result!r}")
        except MiioError as e:
            kind = classify(e.args[0])
            verdict[method] = kind
            if kind == "exists":
                print(f"  \033[33m{label:<52} EXISTS\033[0m (bad params: {e.args[0]})")
            elif kind == "error":
                print(f"  {label:<52} error: {e.args[0]}")
        except TimeoutError:
            verdict[method] = "timeout"
            print(f"  {label:<52} timeout")
        time.sleep(delay)
    return verdict


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ip")
    ap.add_argument("--token")
    ap.add_argument("--discover", action="store_true")
    ap.add_argument("--call", nargs=2, metavar=("METHOD", "JSON_PARAMS"))
    ap.add_argument("--delay", type=float, default=0.35,
                    help="pause between probes; the camera rate-limits")
    ap.add_argument("--unsafe", action="store_true",
                    help="also probe destructive methods such as sdcard_format")
    ap.add_argument("--out", help="write findings to this JSON file")
    args = ap.parse_args()

    if args.discover:
        for d in discover():
            tok = d["token"] or "(not disclosed)"
            print(f'{d["ip"]:<16} id={d["device_id"]:<12} token={tok}')
        return 0

    if not (args.ip and args.token):
        ap.error("--ip and --token are required (or use --discover)")

    dev = Device(args.ip, args.token)
    try:
        hdr = dev.handshake()
    except Exception as e:
        print(f"handshake failed: {e}", file=sys.stderr)
        return 1
    print(f"connected: device_id={hdr.device_id} stamp={hdr.stamp}")

    if args.call:
        method, raw = args.call
        print(json.dumps(dev.send(method, json.loads(raw)), indent=2))
        return 0

    try:
        print(json.dumps(dev.info(), indent=2))
    except Exception as e:
        print(f"miIO.info failed: {e}")

    findings = {
        "ip": args.ip,
        "props": probe_props(dev, args.delay),
        "methods": probe_methods(dev, args.delay, args.unsafe),
    }

    real = [m for m, v in findings["methods"].items() if v in ("ok", "exists")]
    print(f"\n{len(real)} method(s) look real: {', '.join(real) or '(none)'}")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(findings, f, indent=2)
        print(f"written to {args.out}")
    dev.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
