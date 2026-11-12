import v from './tutkVectors.json';

import {
  STAGE_BROADCAST,
  STAGE_DIRECT,
  Session16Packets,
  connectByUID,
  icam,
  reverseTransCode,
  transCode,
  xxteaDecrypt16,
} from '../src/p2p/tutkCodec';

/**
 * Every expected value here was produced by go2rtc's pkg/tutk Go code run
 * unmodified (tools/tutk-vectors). go2rtc talks to isa.camera.df3, so byte
 * equality with it is the strongest check available without the camera.
 */

const hex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map(b => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

describe('TransCode matches go2rtc for every block/tail length', () => {
  for (const [, c] of Object.entries(v.transcode)) {
    const n = c.plain.length / 2;
    it(`scrambles ${n} bytes`, () => {
      expect(toHex(transCode(hex(c.plain)))).toBe(c.trans);
    });
    it(`unscrambles ${n} bytes`, () => {
      expect(toHex(reverseTransCode(hex(c.plain)))).toBe(c.reverse);
    });
    it(`round-trips ${n} bytes`, () => {
      expect(toHex(reverseTransCode(transCode(hex(c.plain))))).toBe(c.plain);
    });
  }
});

describe('XXTEA matches go2rtc', () => {
  for (const c of v.xxtea) {
    it(`decrypts with key ${c.key}`, () => {
      expect(toHex(xxteaDecrypt16(hex(c.src), new TextEncoder().encode(c.key)))).toBe(c.dst);
    });
  }
});

describe('packet builders match go2rtc', () => {
  const sid = hex(v.connect.sid);

  it('builds the LAN broadcast connect packet', () => {
    expect(toHex(connectByUID(STAGE_BROADCAST, v.connect.uid, sid))).toBe(v.connect.broadcast);
  });

  it('builds the LAN direct connect packet', () => {
    expect(toHex(connectByUID(STAGE_DIRECT, v.connect.uid, sid))).toBe(v.connect.direct);
  });

  it('builds ICAM commands', () => {
    expect(toHex(icam(0x0400be))).toBe(v.icam.loginAsk);
    expect(toHex(icam(0x0400c0, 9, 8, 7, 0, 0, 0, 0, 1, 1, 1))).toBe(v.icam.withArgs);
  });

  it('builds both ClientStart packets (time bytes zeroed)', () => {
    const s = new Session16Packets(sid);
    expect(toHex(s.clientStart(0, 'admin', '', 0))).toBe(v.session16.clientStart0);
    expect(toHex(s.clientStart(1, 'admin', '', 0))).toBe(v.session16.clientStart1);
  });

  it('builds the first IOCtrl with sequence 1', () => {
    const s = new Session16Packets(sid);
    expect(toHex(s.sendIOCtrl(0x0100, icam(0x0400be), 0))).toBe(v.session16.ioctrlFirst);
  });
});
