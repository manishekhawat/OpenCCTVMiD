import CryptoJS from 'crypto-js';

/**
 * miIO wire format — a 32-byte header followed by an AES-128-CBC payload.
 *
 *   0   2  magic 0x2131
 *   2   2  total length (header + payload), big endian
 *   4   4  unknown (zero; 0xFFFFFFFF in hello)
 *   8   4  device id
 *   12  4  device stamp, seconds
 *   16 16  md5 checksum; holds the token while being computed
 *
 * checksum = md5(header[0..16] + token + encrypted_payload)
 * key = md5(token), iv = md5(key + token), PKCS#7.
 *
 * crypto-js rather than react-native-quick-crypto: miIO needs MD5, which the
 * faster library doesn't document support for. These packets are ~100 bytes,
 * so pure JS costs nothing measurable.
 */

export const MAGIC = 0x2131;
export const HEADER_LENGTH = 32;
export const MIIO_PORT = 54321;

export const HELLO = new Uint8Array([0x21, 0x31, 0x00, 0x20, ...Array(28).fill(0xff)]);

type WordArray = CryptoJS.lib.WordArray;

// --- crypto-js interop ------------------------------------------------------
export function toWordArray(bytes: Uint8Array): WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] = (words[i >>> 2] || 0) | (bytes[i] << (24 - 8 * (i % 4)));
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

export function fromWordArray(wa: WordArray): Uint8Array {
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) {
    out[i] = (wa.words[i >>> 2] >>> (24 - 8 * (i % 4))) & 0xff;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function md5(bytes: Uint8Array): Uint8Array {
  return fromWordArray(CryptoJS.MD5(toWordArray(bytes)));
}

export function parseHexToken(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length !== 32) {
    throw new Error(`token must be 32 hex characters, got ${clean.length}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- header -----------------------------------------------------------------
export interface MiioHeader {
  length: number;
  deviceId: number;
  stamp: number;
  checksum: Uint8Array;
}

export function parseHeader(buf: Uint8Array): MiioHeader {
  if (buf.length < HEADER_LENGTH) {
    throw new Error(`short packet: ${buf.length} bytes`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint16(0, false);
  if (magic !== MAGIC) {
    throw new Error(`bad magic 0x${magic.toString(16)}`);
  }
  return {
    length: view.getUint16(2, false),
    deviceId: view.getUint32(8, false),
    stamp: view.getUint32(12, false),
    checksum: buf.slice(16, 32),
  };
}

/** Most firmware blanks this field; older builds leak the token here. */
export function disclosedToken(header: MiioHeader): string | null {
  const allFF = header.checksum.every(b => b === 0xff);
  const allZero = header.checksum.every(b => b === 0x00);
  return allFF || allZero ? null : toHex(header.checksum);
}

// --- the codec --------------------------------------------------------------
export class MiioCodec {
  readonly token: Uint8Array;
  private readonly key: WordArray;
  private readonly iv: WordArray;

  constructor(token: Uint8Array) {
    if (token.length !== 16) {
      throw new Error('token must be 16 bytes (32 hex characters)');
    }
    this.token = token;
    const keyBytes = md5(token);
    this.key = toWordArray(keyBytes);
    this.iv = toWordArray(md5(concat(keyBytes, token)));
  }

  static fromHex(hex: string): MiioCodec {
    return new MiioCodec(parseHexToken(hex));
  }

  /**
   * PKCS#7 is applied by hand and decryption runs with NoPadding, so the
   * bytes match the Python implementation exactly rather than relying on
   * crypto-js's padding behaviour on malformed input.
   */
  encrypt(plain: Uint8Array): Uint8Array {
    const pad = 16 - (plain.length % 16);
    const padded = concat(plain, new Uint8Array(pad).fill(pad));
    const result = CryptoJS.AES.encrypt(toWordArray(padded), this.key, {
      iv: this.iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.NoPadding,
    });
    return fromWordArray(result.ciphertext);
  }

  decrypt(blob: Uint8Array): Uint8Array {
    const params = CryptoJS.lib.CipherParams.create({
      ciphertext: toWordArray(blob),
    });
    const out = fromWordArray(
      CryptoJS.AES.decrypt(params, this.key, {
        iv: this.iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.NoPadding,
      }),
    );
    if (out.length === 0) return out;
    const pad = out[out.length - 1];
    return pad >= 1 && pad <= 16 && pad <= out.length ? out.slice(0, out.length - pad) : out;
  }

  build(deviceId: number, stamp: number, payload: object | null): Uint8Array {
    const body =
      payload === null
        ? new Uint8Array(0)
        : this.encrypt(new Uint8Array(Array.from(JSON.stringify(payload), c => c.charCodeAt(0) & 0xff)));

    const head = new Uint8Array(16);
    const view = new DataView(head.buffer);
    view.setUint16(0, MAGIC, false);
    view.setUint16(2, HEADER_LENGTH + body.length, false);
    view.setUint32(4, 0, false);
    view.setUint32(8, deviceId, false);
    view.setUint32(12, stamp, false);

    const checksum = md5(concat(head, this.token, body));
    return concat(head, checksum, body);
  }

  /** Returns null for a bodiless packet — a hello reply. */
  read(buf: Uint8Array): Record<string, any> | null {
    const header = parseHeader(buf);
    if (buf.length <= HEADER_LENGTH) return null;

    const body = buf.slice(HEADER_LENGTH);
    const expect = md5(concat(buf.slice(0, 16), this.token, body));
    for (let i = 0; i < 16; i++) {
      if (expect[i] !== header.checksum[i]) {
        throw new Error('checksum mismatch — wrong token?');
      }
    }

    const text = Array.from(this.decrypt(body), b => String.fromCharCode(b))
      .join('')
      .replace(/\0/g, '')
      .trim();
    return JSON.parse(text);
  }
}
