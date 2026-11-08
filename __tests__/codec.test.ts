import vectors from './vectors.json';

import {
  HELLO,
  HEADER_LENGTH,
  MiioCodec,
  disclosedToken,
  md5,
  parseHeader,
  parseHexToken,
  toHex,
} from '../src/miio/codec';

/**
 * These vectors were produced by tools/miio.py, the implementation that was
 * verified against a simulated camera. Asserting them here means the
 * TypeScript port is not merely self-consistent — it agrees byte for byte
 * with the version known to talk to real hardware.
 */

const hex = (s: string) => new Uint8Array(s.match(/../g)?.map(b => parseInt(b, 16)) ?? []);
const codec = MiioCodec.fromHex(vectors.token);

describe('key derivation', () => {
  it('derives the same key as the Python implementation', () => {
    expect(toHex(md5(parseHexToken(vectors.token)))).toBe(vectors.key);
  });

  it('derives the same IV', () => {
    const token = parseHexToken(vectors.token);
    const key = md5(token);
    const combined = new Uint8Array([...key, ...token]);
    expect(toHex(md5(combined))).toBe(vectors.iv);
  });

  it('rejects a token of the wrong length', () => {
    expect(() => parseHexToken('abcd')).toThrow();
    expect(() => new MiioCodec(new Uint8Array(8))).toThrow();
  });

  it('ignores separators in a pasted token', () => {
    expect(parseHexToken('55:41:63:47:49:66:58:59:69:6a:30:41:4c:4e:55:37')).toEqual(
      parseHexToken(vectors.token),
    );
  });
});

describe('encryption matches Python byte for byte', () => {
  for (const [name, vector] of Object.entries(vectors.encrypt)) {
    it(`encrypts the "${name}" vector identically`, () => {
      expect(toHex(codec.encrypt(hex(vector.plain)))).toBe(vector.cipher);
    });

    it(`decrypts the "${name}" vector back`, () => {
      expect(toHex(codec.decrypt(hex(vector.cipher)))).toBe(vector.plain);
    });
  }

  it('round-trips arbitrary lengths', () => {
    for (const size of [0, 1, 15, 16, 17, 320]) {
      const plain = new Uint8Array(Array.from({ length: size }, (_, i) => i % 256));
      const blob = codec.encrypt(plain);
      expect(blob.length % 16).toBe(0);
      expect(codec.decrypt(blob)).toEqual(plain);
    }
  });

  it('does not decrypt under a different token', () => {
    const other = new MiioCodec(new Uint8Array(16));
    const blob = codec.encrypt(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(other.decrypt(blob)).not.toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });
});

describe('framing', () => {
  it('builds the exact packet Python builds', () => {
    const packet = codec.build(0x01a2b3c4, 123, { id: 7, method: 'miIO.info', params: [] });
    expect(toHex(packet)).toBe(vectors.packet);
  });

  it('parses the Python-built packet', () => {
    const packet = hex(vectors.packet);
    const header = parseHeader(packet);
    expect(header.length).toBe(packet.length);
    expect(header.deviceId).toBe(0x01a2b3c4);
    expect(header.stamp).toBe(123);

    const payload = codec.read(packet);
    expect(payload).toMatchObject({ id: 7, method: 'miIO.info' });
  });

  it('has a 32-byte hello of the documented shape', () => {
    expect(HELLO.length).toBe(HEADER_LENGTH);
    expect(Array.from(HELLO.slice(0, 4))).toEqual([0x21, 0x31, 0x00, 0x20]);
    expect(HELLO.slice(4).every(b => b === 0xff)).toBe(true);
  });

  it('reads a bodiless reply as null', () => {
    expect(codec.read(HELLO)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const packet = hex(vectors.packet);
    packet[packet.length - 1] ^= 0xff;
    expect(() => codec.read(packet)).toThrow(/checksum/);
  });

  it('rejects bad magic', () => {
    expect(() => parseHeader(new Uint8Array(32))).toThrow(/magic/);
  });

  it('rejects a short buffer', () => {
    expect(() => parseHeader(new Uint8Array(10))).toThrow(/short/);
  });

  it('survives a non-zero byteOffset', () => {
    // Uint8Array views into a larger buffer broke an earlier DataView call.
    const backing = new Uint8Array(160);
    backing.set(hex(vectors.packet), 16);
    const view = backing.subarray(16);
    expect(parseHeader(view).deviceId).toBe(0x01a2b3c4);
  });
});

describe('token disclosure', () => {
  const headerWith = (bytes: number[]) => ({
    length: 32,
    deviceId: 1,
    stamp: 1,
    checksum: new Uint8Array(bytes),
  });

  it('treats 0xFF padding as no token', () => {
    expect(disclosedToken(headerWith(Array(16).fill(0xff)))).toBeNull();
  });

  it('treats zero padding as no token', () => {
    expect(disclosedToken(headerWith(Array(16).fill(0)))).toBeNull();
  });

  it('reads anything else as a leaked token', () => {
    expect(disclosedToken(headerWith(Array.from(parseHexToken(vectors.token))))).toBe(
      vectors.token,
    );
  });
});
