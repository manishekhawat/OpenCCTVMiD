#!/usr/bin/env python3
"""Vectors for src/p2p/missCrypto.ts — go2rtc pkg/xiaomi/crypto/crypto.go.

The primitives are standard, so independent implementations stand in for
Go's x/crypto (which needs a newer Go than this machine has):

  CalcSharedKey  = NaCl box.Precompute  = PyNaCl Box(priv, pub).shared_key()
  Encode/Decode  = ChaCha20 (unauthenticated, RFC 8439, counter 0) with a
                   12-byte nonce of 4 zero bytes + an 8-byte random nonce;
                   the 8-byte nonce is prepended to the ciphertext.

Run: python3 tools/miss_vectors.py > __tests__/missVectors.json
"""
import json

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms
from nacl.public import Box, PrivateKey, PublicKey


def chacha20(key: bytes, nonce12: bytes, data: bytes) -> bytes:
    # cryptography takes a 16-byte nonce: 4-byte little-endian counter + 12-byte nonce.
    enc = Cipher(algorithms.ChaCha20(key, b"\x00" * 4 + nonce12), mode=None).encryptor()
    return enc.update(data)


def go2rtc_encode(src: bytes, key: bytes, nonce8: bytes) -> bytes:
    return nonce8 + chacha20(key, b"\x00" * 4 + nonce8, src)


client_priv = PrivateKey(bytes(range(1, 33)))
device_priv = PrivateKey(bytes(range(101, 133)))
shared = Box(client_priv, device_priv.public_key).shared_key()
# Both directions agree — the camera computes the same key.
assert shared == Box(device_priv, client_priv.public_key).shared_key()

nonce8 = bytes([9, 8, 7, 6, 5, 4, 3, 2])
plain = b"\x7f\xff\xff\xff" + b"49434" + bytes(range(40))
encoded = go2rtc_encode(plain, shared, nonce8)

print(json.dumps({
    "clientPrivate": bytes(client_priv).hex(),
    "clientPublic": bytes(client_priv.public_key).hex(),
    "devicePublic": bytes(device_priv.public_key).hex(),
    "shared": shared.hex(),
    "nonce8": nonce8.hex(),
    "plain": plain.hex(),
    "encoded": encoded.hex(),
}, indent=2))
