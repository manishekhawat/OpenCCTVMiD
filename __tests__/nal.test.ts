import { describeNals, isKeyframe, splitNals } from '../src/p2p/nal';

const sc4 = [0, 0, 0, 1];
const sc3 = [0, 0, 1];

describe('splitNals', () => {
  it('names an H.264 keyframe: SPS PPS IDR', () => {
    const p = new Uint8Array([...sc4, 0x67, 1, 2, ...sc4, 0x68, 3, ...sc3, 0x65, 9, 9, 9]);
    const n = splitNals(p, 'h264');
    expect(n.map(x => x.name)).toEqual(['SPS', 'PPS', 'IDR']);
    expect(n.map(x => x.size)).toEqual([3, 2, 4]);
    expect(isKeyframe(n)).toBe(true);
  });

  it('reads 0x40 as an H.264 unit when the header says H.264', () => {
    // The byte the old inspector misread as an H.265 VPS.
    const n = splitNals(new Uint8Array([...sc4, 0x40, 1]), 'h264');
    expect(n[0].type).toBe(0);
  });

  it('names H.265 VPS SPS PPS IDR', () => {
    const p = new Uint8Array([...sc4, 0x40, 1, ...sc4, 0x42, 1, ...sc4, 0x44, 1, ...sc4, 0x26, 1]);
    expect(splitNals(p, 'h265').map(x => x.name)).toEqual(['VPS', 'SPS', 'PPS', 'IDR']);
  });

  it('a P-frame is not a keyframe', () => {
    const n = splitNals(new Uint8Array([...sc4, 0x41, 7, 7]), 'h264');
    expect(n[0].name).toBe('P');
    expect(isKeyframe(n)).toBe(false);
  });

  it('reports frames without a start code', () => {
    expect(describeNals(splitNals(new Uint8Array([1, 2, 3]), 'h264'))).toBe('no start code');
  });
});
