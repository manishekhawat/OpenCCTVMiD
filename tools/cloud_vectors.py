#!/usr/bin/env python3
"""Golden vectors for src/cloud/crypto.ts.

The functions below are copied verbatim (as static functions) from
PiotrMachowski/Xiaomi-cloud-tokens-extractor's XiaomiCloudConnector — the
client that extracted a working token for this camera. Inputs are fixed so
the output is deterministic; the TypeScript port must reproduce it exactly.

Run:  python3 tools/cloud_vectors.py > __tests__/cloudVectors.json
"""
import base64
import hashlib
import json

from Crypto.Cipher import ARC4


# ---- verbatim from token_extractor.py ------------------------------------
def signed_nonce_sec(nonce, ssecurity):
    hash_object = hashlib.sha256(base64.b64decode(ssecurity) + base64.b64decode(nonce))
    return base64.b64encode(hash_object.digest()).decode("utf-8")


def generate_enc_signature(url, method, signed_nonce, params):
    signature_params = [str(method).upper(), url.split("com")[1].replace("/app/", "/")]
    for k, v in params.items():
        signature_params.append(f"{k}={v}")
    signature_params.append(signed_nonce)
    signature_string = "&".join(signature_params)
    return base64.b64encode(hashlib.sha1(signature_string.encode("utf-8")).digest()).decode()


def encrypt_rc4(password, payload):
    r = ARC4.new(base64.b64decode(password))
    r.encrypt(bytes(1024))
    return base64.b64encode(r.encrypt(payload.encode())).decode()


def decrypt_rc4(password, payload):
    r = ARC4.new(base64.b64decode(password))
    r.encrypt(bytes(1024))
    return r.encrypt(base64.b64decode(payload))
# ---------------------------------------------------------------------------


SSECURITY = base64.b64encode(bytes(range(16))).decode()
NONCE = base64.b64encode(bytes([7, 1, 2, 3, 4, 5, 6, 8]) + (29_000_000).to_bytes(4, "big")).decode()
URL = "https://i2.api.io.mi.com/app/v2/homeroom/gethome"
DATA = '{"fg": true, "fetch_share": true, "fetch_share_dev": true, "limit": 300, "app_ver": 7}'

sn = signed_nonce_sec(NONCE, SSECURITY)
params = {"data": DATA}
params["rc4_hash__"] = generate_enc_signature(URL, "POST", sn, params)
rc4_hash = params["rc4_hash__"]
for k, v in params.items():
    params[k] = encrypt_rc4(sn, v)
signature = generate_enc_signature(URL, "POST", sn, params)

reply_plain = '{"code":0,"message":"ok","result":{"homelist":[{"id":"122"}]}}'
reply_b64 = encrypt_rc4(sn, reply_plain)
assert decrypt_rc4(sn, reply_b64).decode() == reply_plain

print(json.dumps({
    "ssecurity": SSECURITY,
    "nonce": NONCE,
    "path": "/v2/homeroom/gethome",
    "data": DATA,
    "signedNonce": sn,
    "rc4_hash__plain": rc4_hash,
    "form": {"data": params["data"], "rc4_hash__": params["rc4_hash__"], "signature": signature},
    "reply": {"plain": reply_plain, "encrypted": reply_b64},
    "passwordHash": {"input": "correct horse ✓", "md5Upper": hashlib.md5("correct horse ✓".encode()).hexdigest().upper()},
}, indent=2, ensure_ascii=False))
