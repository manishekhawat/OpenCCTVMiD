import { chacha20 } from '@noble/ciphers/chacha';
import nacl from 'tweetnacl';

import { randomBytes } from '../cloud/crypto';
import { icam } from './tutkCodec';

/** Pure parts of the MISS layer (see miss.ts); free of native imports for Jest. */

const fromHex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map(b => parseInt(b, 16)));
const ascii = (s: string) => new TextEncoder().encode(s);

// --- crypto (pkg/xiaomi/crypto) ----------------------------------------------

/** go2rtc CalcSharedKey = NaCl box.Precompute. */
export const sharedKey = (devicePublicHex: string, clientPrivateHex: string): Uint8Array =>
  nacl.box.before(fromHex(devicePublicHex), fromHex(clientPrivateHex));

const nonce12 = (nonce8: Uint8Array) => {
  const n = new Uint8Array(12);
  n.set(nonce8, 4);
  return n;
};

/** go2rtc Encode: 8-byte random nonce, then ChaCha20 of the data. */
export function encode(src: Uint8Array, key: Uint8Array, nonce8: Uint8Array = randomBytes(8)): Uint8Array {
  const out = new Uint8Array(8 + src.length);
  out.set(nonce8, 0);
  out.set(chacha20(key, nonce12(nonce8), src), 8);
  return out;
}

/** go2rtc Decode. */
export const decode = (src: Uint8Array, key: Uint8Array): Uint8Array =>
  chacha20(key, nonce12(src.subarray(0, 8)), src.subarray(8));

// --- Dafang commands ----------------------------------------------------------

/** go2rtc dafangRaw: "\x7f\xff\xff\xff" + hex(ICAM(cmd, args)). */
export function dafangRaw(cmd: number, ...args: number[]): Uint8Array {
  const payload = icam(cmd, ...args);
  const hex = Array.from(payload, b => b.toString(16).padStart(2, '0')).join('');
  const out = new Uint8Array(4 + hex.length);
  out.set([0x7f, 0xff, 0xff, 0xff], 0);
  out.set(ascii(hex), 4);
  return out;
}

export type Direction = 'left' | 'right' | 'up' | 'down' | 'stop';

/** [x, y] per go2rtc's commented-out dafangLeft/Right/Up/Down/Stop. */
const PTZ: Record<Direction, [number, number]> = {
  left: [2, 0],
  right: [1, 0],
  up: [0, 2],
  down: [0, 1],
  stop: [0, 0],
};

export const dafangPtz = (d: Direction, speed = 5) => dafangRaw(0xff2404, ...PTZ[d], speed);
export const dafangQuality = (sd: boolean) => dafangRaw(0xff07d5, sd ? 1 : 0);
export const dafangVideoStart = (audio: boolean) => dafangRaw(0xff07d8, 1, audio ? 1 : 0);

export const authRequest = (clientPublic: string, sign: string) =>
  ascii(`{"public_key":"${clientPublic}","sign":"${sign}","uuid":"","support_encrypt":0}`);

