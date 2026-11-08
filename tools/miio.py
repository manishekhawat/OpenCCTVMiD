"""Minimal miIO (Xiaomi local) protocol client.

No external deps beyond pycryptodome OR cryptography; falls back to a tiny
pure-python AES if neither is present, so this runs anywhere.

Wire format (UDP 54321), 32-byte header + encrypted payload:

    offset  size  field
    0       2     magic 0x2131
    2       2     total length (header + payload), big endian
    4       4     unknown (0x00000000; 0xFFFFFFFF in hello)
    8       4     device id  (0xFFFFFFFF in hello)
    12      4     device stamp, seconds (0xFFFFFFFF in hello)
    16      16    md5 checksum; during computation this field holds the token

Checksum  = md5(header[0:16] + token + encrypted_payload)
Crypto    = AES-128-CBC, key = md5(token), iv = md5(key + token), PKCS#7
"""

from __future__ import annotations

import hashlib
import json
import socket
import struct
import time
from dataclasses import dataclass

MAGIC = 0x2131
HEADER_LEN = 32
HELLO = bytes.fromhex("21310020ffffffffffffffffffffffff") + b"\xff" * 16
PORT = 54321


# --------------------------------------------------------------------------- #
# AES-128-CBC
# --------------------------------------------------------------------------- #
def _aes_backend():
    try:
        from Crypto.Cipher import AES  # pycryptodome

        def enc(k, iv, d):
            return AES.new(k, AES.MODE_CBC, iv).encrypt(d)

        def dec(k, iv, d):
            return AES.new(k, AES.MODE_CBC, iv).decrypt(d)

        return enc, dec
    except ImportError:
        pass
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    def enc(k, iv, d):
        c = Cipher(algorithms.AES(k), modes.CBC(iv)).encryptor()
        return c.update(d) + c.finalize()

    def dec(k, iv, d):
        c = Cipher(algorithms.AES(k), modes.CBC(iv)).decryptor()
        return c.update(d) + c.finalize()

    return enc, dec


_encrypt_raw, _decrypt_raw = _aes_backend()


def _pad(d: bytes) -> bytes:
    n = 16 - len(d) % 16
    return d + bytes([n]) * n


def _unpad(d: bytes) -> bytes:
    if not d:
        return d
    n = d[-1]
    return d[:-n] if 1 <= n <= 16 else d


def derive(token: bytes) -> tuple[bytes, bytes]:
    key = hashlib.md5(token).digest()
    iv = hashlib.md5(key + token).digest()
    return key, iv


def encrypt(token: bytes, data: bytes) -> bytes:
    key, iv = derive(token)
    return _encrypt_raw(key, iv, _pad(data))


def decrypt(token: bytes, data: bytes) -> bytes:
    key, iv = derive(token)
    return _unpad(_decrypt_raw(key, iv, data))


# --------------------------------------------------------------------------- #
# Packets
# --------------------------------------------------------------------------- #
@dataclass
class Header:
    length: int
    device_id: int
    stamp: int
    checksum: bytes


def parse_header(buf: bytes) -> Header:
    if len(buf) < HEADER_LEN:
        raise ValueError(f"short packet: {len(buf)} bytes")
    magic, length, _unknown, did, stamp = struct.unpack(">HHIII", buf[:16])
    if magic != MAGIC:
        raise ValueError(f"bad magic 0x{magic:04x}")
    return Header(length, did, stamp, buf[16:32])


def build(token: bytes, device_id: int, stamp: int, payload: dict | None) -> bytes:
    # Compact separators, matching JavaScript's JSON.stringify, so the Python
    # and TypeScript clients emit byte-identical packets and can be verified
    # against each other.
    blob = json.dumps(payload, separators=(",", ":")).encode()
    body = b"" if payload is None else encrypt(token, blob)
    head = struct.pack(">HHIII", MAGIC, HEADER_LEN + len(body), 0, device_id, stamp)
    checksum = hashlib.md5(head + token + body).digest()
    return head + checksum + body


def read(token: bytes, buf: bytes) -> tuple[Header, dict | None]:
    hdr = parse_header(buf)
    body = buf[HEADER_LEN:]
    if not body:
        return hdr, None
    expect = hashlib.md5(buf[:16] + token + body).digest()
    if expect != hdr.checksum:
        raise ValueError("checksum mismatch — wrong token?")
    return hdr, json.loads(decrypt(token, body).rstrip(b"\x00").decode())


# --------------------------------------------------------------------------- #
# Device
# --------------------------------------------------------------------------- #
class MiioError(Exception):
    pass


class Device:
    def __init__(self, ip: str, token: str, port: int = PORT, timeout: float = 3.0):
        self.ip = ip
        self.token = bytes.fromhex(token)
        if len(self.token) != 16:
            raise ValueError("token must be 32 hex characters")
        self.port = port
        self.timeout = timeout
        self.device_id = 0
        self._stamp = 0
        self._stamp_at = 0.0
        self._id = 1
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.settimeout(timeout)

    # -- handshake -------------------------------------------------------- #
    def handshake(self) -> Header:
        self._sock.sendto(HELLO, (self.ip, self.port))
        data, _ = self._sock.recvfrom(4096)
        hdr = parse_header(data)
        self.device_id = hdr.device_id
        self._stamp = hdr.stamp
        self._stamp_at = time.monotonic()
        return hdr

    @property
    def stamp(self) -> int:
        return self._stamp + int(time.monotonic() - self._stamp_at)

    # -- rpc -------------------------------------------------------------- #
    def send(self, method: str, params=None, retries: int = 2):
        if not self._stamp_at:
            self.handshake()
        self._id = self._id % 9999 + 1
        payload = {"id": self._id, "method": method, "params": params or []}
        last = None
        for attempt in range(retries + 1):
            try:
                self._sock.sendto(
                    build(self.token, self.device_id, self.stamp, payload),
                    (self.ip, self.port),
                )
                while True:
                    data, _ = self._sock.recvfrom(8192)
                    _, resp = read(self.token, data)
                    if resp is None:
                        continue
                    if resp.get("id") != payload["id"]:
                        continue  # stale reply from an earlier request
                    if "error" in resp:
                        raise MiioError(resp["error"])
                    return resp.get("result")
            except socket.timeout as e:
                last = e
                if attempt < retries:
                    self.handshake()  # stamp may have drifted
        raise TimeoutError(f"no reply from {self.ip}:{self.port}") from last

    def info(self):
        return self.send("miIO.info")

    def get_prop(self, props):
        return self.send("get_prop", list(props))

    def close(self):
        self._sock.close()


# --------------------------------------------------------------------------- #
# Discovery
# --------------------------------------------------------------------------- #
def discover(broadcast: str = "255.255.255.255", timeout: float = 5.0) -> list[dict]:
    """Broadcast a hello and collect replies.

    Some firmware answers with the token in bytes 16..31; most modern firmware
    returns 0xFF*16 or 0x00*16 there, meaning the token must come from the
    Mi Home app database or the cloud.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(0.6)
    s.sendto(HELLO, (broadcast, PORT))
    found: dict[str, dict] = {}
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            data, addr = s.recvfrom(4096)
        except socket.timeout:
            continue
        try:
            hdr = parse_header(data)
        except ValueError:
            continue
        tok = hdr.checksum
        disclosed = tok not in (b"\xff" * 16, b"\x00" * 16)
        found[addr[0]] = {
            "ip": addr[0],
            "device_id": hdr.device_id,
            "stamp": hdr.stamp,
            "token": tok.hex() if disclosed else None,
        }
    s.close()
    return list(found.values())
