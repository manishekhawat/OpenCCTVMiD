/**
 * Splits an Annex-B video frame into NAL units and names them.
 *
 * The first P2P run reported "H.265 VPS" for frames the camera's own header
 * labelled H.264 — the old inspector guessed the codec from one byte, and
 * the bit layouts of the two codecs overlap. The header says which codec it
 * is; this reads the units with that codec's layout.
 */

export type Codec = 'h264' | 'h265';

export interface Nal {
  type: number;
  name: string;
  offset: number;
  size: number;
}

const H264: Record<number, string> = { 1: 'P', 5: 'IDR', 6: 'SEI', 7: 'SPS', 8: 'PPS', 9: 'AUD' };
const H265: Record<number, string> = { 1: 'TRAIL', 19: 'IDR', 20: 'IDR', 21: 'CRA', 32: 'VPS', 33: 'SPS', 34: 'PPS', 35: 'AUD', 39: 'SEI' };

/** Start-code positions: [index of first payload byte, start-code length]. */
function startCodes(p: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 2 < p.length; i++) {
    if (p[i] === 0 && p[i + 1] === 0) {
      if (p[i + 2] === 1) {
        out.push([i + 3, 3]);
        i += 2;
      } else if (p[i + 2] === 0 && i + 3 < p.length && p[i + 3] === 1) {
        out.push([i + 4, 4]);
        i += 3;
      }
    }
  }
  return out;
}

export function splitNals(p: Uint8Array, codec: Codec): Nal[] {
  const starts = startCodes(p);
  return starts.map(([offset], k) => {
    const end = k + 1 < starts.length ? starts[k + 1][0] - starts[k + 1][1] : p.length;
    const b = p[offset];
    const type = codec === 'h264' ? b & 0x1f : (b >> 1) & 0x3f;
    const names = codec === 'h264' ? H264 : H265;
    return { type, name: names[type] ?? `type${type}`, offset, size: end - offset };
  });
}

export const isKeyframe = (nals: Nal[]) => nals.some(n => n.name === 'IDR' || n.name === 'CRA');

export const describeNals = (nals: Nal[]) =>
  nals.length ? nals.map(n => `${n.name}(${n.size})`).join(' ') : 'no start code';

export const codecFromId = (id: number): Codec | null => (id === 4 ? 'h264' : id === 5 ? 'h265' : null);
