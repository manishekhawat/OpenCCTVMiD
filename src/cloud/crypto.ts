import CryptoJS from 'crypto-js';

import { fromWordArray, toWordArray } from '../miio/codec';

/**
 * The crypto behind Xiaomi's cloud API ("MIOT-ENCRYPT-ALGORITHM: ENCRYPT-RC4").
 *
 * Ported from two independent open-source clients that both work against the
 * live service — PiotrMachowski/Xiaomi-cloud-tokens-extractor (Python) and
 * AlexxIT/go2rtc pkg/xiaomi/cloud.go (Go) — and held to byte-exact vectors
 * generated from the Python one in __tests__/cloudVectors.json.
 *
 * Request flow:
 *   nonce       = 8 random bytes + big-endian uint32(unix minutes)
 *   signedNonce = sha256(ssecurity + nonce)
 *   rc4_hash__  = sig("POST", path, {data})            (over plaintext data)
 *   data, rc4_hash__ = rc4(signedNonce, each)          (base64)
 *   signature   = sig("POST", path, {data, rc4_hash__}) (over ciphertext)
 *   response    = base64(rc4(signedNonce, json))
 *
 *   sig(...)    = base64(sha1(METHOD & path & k=v... & base64(signedNonce)))
 *   rc4(...)    = RC4 with the first 1024 keystream bytes discarded
 */

export const bytesFromBase64 = (b64: string): Uint8Array =>
  fromWordArray(CryptoJS.enc.Base64.parse(b64));

export const bytesToBase64 = (bytes: Uint8Array): string =>
  CryptoJS.enc.Base64.stringify(toWordArray(bytes));

const utf8 = (s: string): Uint8Array => fromWordArray(CryptoJS.enc.Utf8.parse(s));
const fromUtf8 = (b: Uint8Array): string => CryptoJS.enc.Utf8.stringify(toWordArray(b));

export const sha256 = (b: Uint8Array): Uint8Array => fromWordArray(CryptoJS.SHA256(toWordArray(b)));
export const sha1 = (b: Uint8Array): Uint8Array => fromWordArray(CryptoJS.SHA1(toWordArray(b)));

/** The password hash serviceLoginAuth2 expects: uppercase hex MD5. */
export const passwordHash = (password: string): string =>
  CryptoJS.MD5(CryptoJS.enc.Utf8.parse(password)).toString(CryptoJS.enc.Hex).toUpperCase();

/**
 * RC4 with the first 1024 keystream bytes dropped. Written out rather than
 * using CryptoJS.RC4Drop, whose `drop` is counted in 32-bit words: a silent
 * unit mismatch there would produce plausible-looking garbage.
 */
export function rc4Drop1024(key: Uint8Array, input: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  let j = 0;
  const next = () => {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    return s[(s[i] + s[j]) & 0xff];
  };
  for (let n = 0; n < 1024; n++) next();
  const out = new Uint8Array(input.length);
  for (let n = 0; n < input.length; n++) out[n] = input[n] ^ next();
  return out;
}

/** Secure random bytes when the platform has them (index.js installs them). */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(out);
  // Jest without webcrypto. Never reached in the app.
  for (let k = 0; k < n; k++) out[k] = Math.floor(Math.random() * 256);
  return out;
}

/** 8 random bytes + big-endian uint32 of the current minute. */
export function makeNonce(nowMs = Date.now()): Uint8Array {
  const nonce = new Uint8Array(12);
  nonce.set(randomBytes(8), 0);
  new DataView(nonce.buffer).setUint32(8, Math.floor(nowMs / 60000), false);
  return nonce;
}

export const signedNonce = (ssecurity: Uint8Array, nonce: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(ssecurity.length + nonce.length);
  joined.set(ssecurity, 0);
  joined.set(nonce, ssecurity.length);
  return sha256(joined);
};

/** Ordered: the server recomputes over the parameters in the order sent. */
export type Params = [string, string][];

export function encSignature(method: string, path: string, params: Params, signedNonceB64: string): string {
  const parts = [method.toUpperCase(), path, ...params.map(([k, v]) => `${k}=${v}`), signedNonceB64];
  return bytesToBase64(sha1(utf8(parts.join('&'))));
}

/**
 * Builds the encrypted form for one API call. `path` is the API path without
 * the /app prefix, e.g. "/v2/homeroom/gethome".
 */
export function encryptRequest(
  path: string,
  data: string,
  ssecurityB64: string,
  nonce: Uint8Array,
): { form: Params; signedNonceB64: string } {
  const sn = signedNonce(bytesFromBase64(ssecurityB64), nonce);
  const snB64 = bytesToBase64(sn);

  const plain: Params = [['data', data]];
  plain.push(['rc4_hash__', encSignature('POST', path, plain, snB64)]);

  const encrypted: Params = plain.map(([k, v]) => [k, bytesToBase64(rc4Drop1024(sn, utf8(v)))]);
  const signature = encSignature('POST', path, encrypted, snB64);

  return {
    form: [...encrypted, ['signature', signature], ['_nonce', bytesToBase64(nonce)]],
    signedNonceB64: snB64,
  };
}

export function decryptResponse(bodyB64: string, signedNonceB64: string): string {
  return fromUtf8(rc4Drop1024(bytesFromBase64(signedNonceB64), bytesFromBase64(bodyB64.trim())));
}
