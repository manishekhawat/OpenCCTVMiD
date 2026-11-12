import v from './cloudVectors.json';

import {
  bytesFromBase64,
  bytesToBase64,
  decryptResponse,
  encSignature,
  encryptRequest,
  passwordHash,
  rc4Drop1024,
  signedNonce,
} from '../src/cloud/crypto';

/**
 * Vectors come from tools/cloud_vectors.py, which runs the Python token
 * extractor's own functions verbatim on fixed inputs. That extractor pulled a
 * working token for this camera, so matching it byte for byte is the evidence
 * that our requests will be accepted — this code cannot be exercised against
 * the real service from CI.
 */
describe('Xiaomi cloud crypto matches the Python extractor', () => {
  const nonce = bytesFromBase64(v.nonce);

  it('derives the same signed nonce', () => {
    expect(bytesToBase64(signedNonce(bytesFromBase64(v.ssecurity), nonce))).toBe(v.signedNonce);
  });

  it('computes the same rc4_hash__ over the plaintext data', () => {
    expect(encSignature('POST', v.path, [['data', v.data]], v.signedNonce)).toBe(v.rc4_hash__plain);
  });

  it('builds the same encrypted form', () => {
    const { form, signedNonceB64 } = encryptRequest(v.path, v.data, v.ssecurity, nonce);
    const map = Object.fromEntries(form);
    expect(signedNonceB64).toBe(v.signedNonce);
    expect(map.data).toBe(v.form.data);
    expect(map.rc4_hash__).toBe(v.form.rc4_hash__);
    expect(map.signature).toBe(v.form.signature);
    expect(map._nonce).toBe(v.nonce);
  });

  it('keeps parameter order: data, rc4_hash__, signature, _nonce', () => {
    const { form } = encryptRequest(v.path, v.data, v.ssecurity, nonce);
    expect(form.map(([k]) => k)).toEqual(['data', 'rc4_hash__', 'signature', '_nonce']);
  });

  it('decrypts a reply encrypted by the Python code', () => {
    expect(decryptResponse(v.reply.encrypted, v.signedNonce)).toBe(v.reply.plain);
  });

  it('hashes the password the way serviceLoginAuth2 expects, including non-ASCII', () => {
    expect(passwordHash(v.passwordHash.input)).toBe(v.passwordHash.md5Upper);
  });
});

describe('rc4Drop1024', () => {
  it('is its own inverse', () => {
    const key = new Uint8Array(32).map((_, i) => i * 7);
    const msg = new Uint8Array(300).map((_, i) => i);
    expect(rc4Drop1024(key, rc4Drop1024(key, msg))).toEqual(msg);
  });

  it('actually drops 1024 bytes (differs from undropped RC4 at byte 0)', () => {
    // Undropped RC4 with key "Key" encrypts "Plaintext" to BBF316E8D940AF0AD3
    // (the classic test vector). Dropping must give something else.
    const key = new Uint8Array([0x4b, 0x65, 0x79]);
    const pt = new Uint8Array([0x50, 0x6c, 0x61, 0x69, 0x6e, 0x74, 0x65, 0x78, 0x74]);
    const hex = Array.from(rc4Drop1024(key, pt), b => b.toString(16).padStart(2, '0')).join('');
    expect(hex).not.toBe('bbf316e8d940af0ad3');
  });
});
