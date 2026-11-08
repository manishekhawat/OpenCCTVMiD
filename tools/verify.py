#!/usr/bin/env python3
"""Fake miIO device + round-trip tests for the protocol implementation.

Run:  python3 -I verify.py
"""

from __future__ import annotations

import hashlib
import json
import socket
import struct
import threading
import time

import miio

TOKEN_HEX = "5541634749665859696a30414c4e5537"
TOKEN = bytes.fromhex(TOKEN_HEX)
DEVICE_ID = 0x01A2B3C4
BASE_STAMP = 1_700_000_000 % 0xFFFFFFFF

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    mark = "\033[32mPASS\033[0m" if cond else "\033[31mFAIL\033[0m"
    print(f"  [{mark}] {name}" + (f"  {detail}" if detail and not cond else ""))


# --------------------------------------------------------------------------- #
class FakeCamera(threading.Thread):
    """Answers hello + a handful of methods the way real firmware does."""

    daemon = True

    def __init__(self) -> None:
        super().__init__()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.running = True
        self.seen: list[str] = []

    def run(self) -> None:
        while self.running:
            try:
                self.sock.settimeout(0.3)
                data, addr = self.sock.recvfrom(4096)
            except socket.timeout:
                continue
            except OSError:
                return
            if data == miio.HELLO:
                head = struct.pack(">HHIII", miio.MAGIC, 32, 0, DEVICE_ID, BASE_STAMP)
                self.sock.sendto(head + b"\xff" * 16, addr)
                continue

            hdr = miio.parse_header(data)
            body = data[32:]
            if hashlib.md5(data[:16] + TOKEN + body).digest() != hdr.checksum:
                continue  # real firmware silently drops bad-token packets
            req = json.loads(miio.decrypt(TOKEN, body).rstrip(b"\x00"))
            self.seen.append(req["method"])
            resp = self.dispatch(req)
            self.sock.sendto(
                miio.build(TOKEN, DEVICE_ID, hdr.stamp, resp), addr
            )

    def dispatch(self, req: dict) -> dict:
        rid, method, params = req["id"], req["method"], req.get("params", [])
        if method == "miIO.info":
            return {"id": rid, "result": {"model": "isa.camera.df3",
                                          "fw_ver": "5.5.1_1025",
                                          "mac": "34:CE:00:E5:18:34"}}
        if method == "get_prop":
            return {"id": rid, "result": ["on" for _ in params]}
        if method == "set_video":
            return {"id": rid, "result": ["ok"]}
        if method == "set_motor":
            if not params or not isinstance(params[0], dict):
                return {"id": rid, "error": {"code": -32602,
                                             "message": "invalid params"}}
            return {"id": rid, "result": ["ok"]}
        return {"id": rid, "error": {"code": -32601,
                                     "message": "unsupported_method"}}

    def stop(self) -> None:
        self.running = False
        self.sock.close()


# --------------------------------------------------------------------------- #
def test_crypto() -> None:
    print("\ncrypto")
    key, iv = miio.derive(TOKEN)
    check("key is md5(token)", key == hashlib.md5(TOKEN).digest())
    check("iv is md5(key+token)", iv == hashlib.md5(key + TOKEN).digest())
    check("key length is 16", len(key) == 16)

    for plain in [b"", b"a", b"x" * 15, b"x" * 16, b"x" * 17, b'{"id":1}' * 40]:
        blob = miio.encrypt(TOKEN, plain)
        check(f"round-trip {len(plain):>3}B", miio.decrypt(TOKEN, blob) == plain)
        check(f"block-aligned {len(plain):>3}B", len(blob) % 16 == 0)

    check("ciphertext differs from plaintext",
          miio.encrypt(TOKEN, b"hello world 1234") != b"hello world 1234")
    other = bytes(16)
    check("wrong token does not decrypt",
          miio.decrypt(other, miio.encrypt(TOKEN, b"secret payload!!")) != b"secret payload!!")


def test_framing() -> None:
    print("\nframing")
    check("hello is 32 bytes", len(miio.HELLO) == 32)
    check("hello magic", miio.HELLO[:2] == b"\x21\x31")
    check("hello declares length 0x20", miio.HELLO[2:4] == b"\x00\x20")
    check("hello body is all 0xFF", set(miio.HELLO[4:]) == {0xFF})

    pkt = miio.build(TOKEN, DEVICE_ID, 123, {"id": 1, "method": "miIO.info",
                                             "params": []})
    hdr = miio.parse_header(pkt)
    check("declared length matches actual", hdr.length == len(pkt))
    check("device id survives", hdr.device_id == DEVICE_ID)
    check("stamp survives", hdr.stamp == 123)
    check("checksum = md5(head16+token+body)",
          hdr.checksum == hashlib.md5(pkt[:16] + TOKEN + pkt[32:]).digest())

    _, payload = miio.read(TOKEN, pkt)
    check("payload decodes", payload["method"] == "miIO.info")

    tampered = bytearray(pkt)
    tampered[-1] ^= 0xFF
    try:
        miio.read(TOKEN, bytes(tampered))
        check("tampered packet rejected", False)
    except ValueError:
        check("tampered packet rejected", True)

    try:
        miio.parse_header(b"\x00\x00" + b"\x00" * 30)
        check("bad magic rejected", False)
    except ValueError:
        check("bad magic rejected", True)


def test_live(cam: FakeCamera) -> None:
    print("\nagainst the fake camera")
    dev = miio.Device("127.0.0.1", TOKEN_HEX, port=cam.port, timeout=2.0)
    hdr = dev.handshake()
    check("handshake returns device id", hdr.device_id == DEVICE_ID)
    check("stamp captured", dev.stamp >= BASE_STAMP)

    info = dev.info()
    check("miIO.info model", info["model"] == "isa.camera.df3", repr(info))
    check("miIO.info firmware", info["fw_ver"] == "5.5.1_1025")

    check("get_prop", dev.get_prop(["power"]) == ["on"])
    check("set_video", dev.send("set_video", ["on"]) == ["ok"])

    try:
        dev.send("set_night_mode", [0])
        check("unknown method raises", False)
    except miio.MiioError as e:
        check("unknown method raises", "unsupported_method" in json.dumps(e.args[0]))

    try:
        dev.send("set_motor", [0], retries=0)
        check("bad params classified as EXISTS", False)
    except miio.MiioError as e:
        from probe import classify
        check("bad params classified as EXISTS", classify(e.args[0]) == "exists")

    check("good params accepted",
          dev.send("set_motor", [{"operation": 0}]) == ["ok"])

    ids = set()
    for _ in range(5):
        dev.send("set_video", ["on"])
        ids.add(dev._id)
    check("request ids increment", len(ids) == 5)

    bad = miio.Device("127.0.0.1", "00" * 16, port=cam.port, timeout=0.6)
    bad.device_id, bad._stamp, bad._stamp_at = DEVICE_ID, BASE_STAMP, time.monotonic()
    try:
        bad.send("miIO.info", retries=0)
        check("wrong token times out", False)
    except (TimeoutError, ValueError):
        check("wrong token times out", True)
    bad.close()
    dev.close()


# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    cam = FakeCamera()
    cam.start()
    try:
        test_crypto()
        test_framing()
        test_live(cam)
    finally:
        cam.stop()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("failed: " + ", ".join(FAIL))
        raise SystemExit(1)
