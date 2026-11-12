import tv from './tutkVectors.json';
import mv from './missVectors.json';

import { authRequest, dafangPtz, dafangQuality, dafangRaw, dafangVideoStart, decode, encode, sharedKey } from '../src/p2p/missCodec';

const hex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map(b => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/**
 * Dafang command bytes come from go2rtc's own Go code (tools/tutk-vectors);
 * crypto from PyNaCl and Python's cryptography (tools/miss_vectors.py),
 * independent implementations of the same standard primitives go2rtc uses.
 */
describe('Dafang MISS commands match go2rtc', () => {
  it('video quality HD', () => expect(toHex(dafangQuality(false))).toBe(tv.dafang.quality_hd));
  it('video start with audio', () => expect(toHex(dafangVideoStart(true))).toBe(tv.dafang.video_start));
  for (const d of ['left', 'right', 'up', 'down', 'stop'] as const) {
    it(`pan/tilt ${d}`, () => expect(toHex(dafangPtz(d))).toBe(tv.dafang[d]));
  }
  it('dafangRaw is ICAM hex-encoded behind 7fffffff', () => {
    expect(toHex(dafangRaw(0xff2404, 0, 0, 5)).startsWith('7fffffff')).toBe(true);
  });
  it('auth request JSON', () => expect(toHex(authRequest('aa', 'bb'))).toBe(tv.dafang.auth));
});

describe('MISS crypto matches the reference implementations', () => {
  it('derives the NaCl shared key', () => {
    expect(toHex(sharedKey(mv.devicePublic, mv.clientPrivate))).toBe(mv.shared);
  });

  it('encodes with the 8-byte nonce prepended, ChaCha20 behind it', () => {
    expect(toHex(encode(hex(mv.plain), hex(mv.shared), hex(mv.nonce8)))).toBe(mv.encoded);
  });

  it('decodes what Python encoded', () => {
    expect(toHex(decode(hex(mv.encoded), hex(mv.shared)))).toBe(mv.plain);
  });
});
