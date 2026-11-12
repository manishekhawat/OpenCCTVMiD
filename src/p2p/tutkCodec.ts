/**
 * TUTK wire format — the P2P transport Xiaomi's Dafang uses for video, audio
 * and the camera's own control commands.
 *
 * Ported from AlexxIT/go2rtc pkg/tutk (crypto.go, helpers.go, session0.go,
 * session16.go). Everything here is pure and is asserted byte-for-byte
 * against vectors produced by running go2rtc's Go code unmodified
 * (__tests__/tutkVectors.json, tools/tutk-vectors/).
 */

// --- "TransCode": the fixed scrambling applied to every UDP datagram --------

// go2rtc's comment: "I'd like to say hello to Charlie. Your name is forever
// etched into the history of streaming software."
const CHARLIE = new TextEncoder().encode('Charlie is the designer of P2P!!');

const rotl32 = (x: number, k: number): number => {
  const r = ((k % 32) + 32) % 32;
  return r === 0 ? x >>> 0 : ((x << r) | (x >>> (32 - r))) >>> 0;
};
const readU32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const writeU32 = (b: Uint8Array, o: number, v: number) => {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
};

/** go2rtc `swap`: byte permutations for blocks of 2, 4, 8 and 16. */
function swap(dst: Uint8Array, dOff: number, src: Uint8Array, sOff: number, n: number) {
  const s = (i: number) => src[sOff + i];
  const d = (i: number, v: number) => {
    dst[dOff + i] = v;
  };
  switch (n) {
    case 2: {
      const a = s(0), b = s(1);
      d(0, b); d(1, a);
      return;
    }
    case 4: {
      const v = [s(2), s(3), s(0), s(1)];
      v.forEach((x, i) => d(i, x));
      return;
    }
    case 8: {
      const v = [s(7), s(4), s(3), s(2), s(1), s(6), s(5), s(0)];
      v.forEach((x, i) => d(i, x));
      return;
    }
    case 16: {
      const order = [11, 9, 8, 15, 13, 10, 12, 14, 2, 1, 5, 0, 6, 4, 7, 3];
      const v = order.map(i => s(i));
      v.forEach((x, i) => d(i, x));
      return;
    }
  }
  const copy = Array.from({ length: n }, (_, i) => s(i));
  copy.forEach((x, i) => d(i, x));
}

/** Scramble an outgoing datagram. */
export function transCode(src: Uint8Array): Uint8Array {
  let n = src.length;
  const dst = new Uint8Array(n);
  const tmp = new Uint8Array(n);
  let o = 0;
  for (; n >= 16; n -= 16, o += 16) {
    for (let i = 0; i < 16; i += 4) writeU32(tmp, o + i, rotl32(readU32(src, o + i), -i - 1));
    for (let i = 0; i < 16; i++) dst[o + i] = tmp[o + i] ^ CHARLIE[i];
    swap(tmp, o, dst, o, 16);
    for (let i = 0; i < 16; i += 4) writeU32(dst, o + i, rotl32(readU32(tmp, o + i), -i - 3));
  }
  for (let i = 0; i < n; i++) tmp[o + i] = src[o + i] ^ CHARLIE[i];
  swap(dst, o, tmp, o, n);
  return dst;
}

/** Unscramble an incoming datagram. */
export function reverseTransCode(src: Uint8Array): Uint8Array {
  let n = src.length;
  const dst = new Uint8Array(n);
  const tmp = new Uint8Array(n);
  let o = 0;
  for (; n >= 16; n -= 16, o += 16) {
    for (let i = 0; i < 16; i += 4) writeU32(tmp, o + i, rotl32(readU32(src, o + i), i + 3));
    swap(dst, o, tmp, o, 16);
    for (let i = 0; i < 16; i++) tmp[o + i] = dst[o + i] ^ CHARLIE[i];
    for (let i = 0; i < 16; i += 4) writeU32(dst, o + i, rotl32(readU32(tmp, o + i), i + 1));
  }
  swap(tmp, o, src, o, n);
  for (let i = 0; i < n; i++) dst[o + i] = tmp[o + i] ^ CHARLIE[i];
  return dst;
}

// --- XXTEA, used by the Dafang login -----------------------------------------

const DELTA = 0x9e3779b9;

/** go2rtc XXTEADecrypt: one 16-byte block, 16-byte key. */
export function xxteaDecrypt16(src: Uint8Array, key: Uint8Array): Uint8Array {
  const w = [0, 1, 2, 3].map(i => readU32(src, i * 4));
  const k = [0, 1, 2, 3].map(i => readU32(key, i * 4));
  let rounds = Math.floor(52 / 4) + 6;
  let sum = Math.imul(rounds, DELTA) >>> 0;
  for (; rounds > 0; rounds--) {
    let w0 = w[0];
    const i2 = (sum >>> 2) & 3;
    for (let i = 3; i >= 0; i--) {
      const wi = w[(i - 1) & 3];
      const ki = k[i ^ i2];
      const t1 = ((w0 ^ sum) + (wi ^ ki)) >>> 0;
      const t2 = ((wi >>> 5) ^ (w0 << 2)) >>> 0;
      const t3 = ((w0 >>> 3) ^ (wi << 4)) >>> 0;
      w[i] = (w[i] - ((t1 ^ ((t2 + t3) >>> 0)) >>> 0)) >>> 0;
      w0 = w[i];
    }
    sum = (sum - DELTA) >>> 0;
  }
  const out = new Uint8Array(16);
  w.forEach((v, i) => writeU32(out, i * 4, v));
  return out;
}

// --- packet builders -----------------------------------------------------------

const MAGIC = [0x04, 0x02, 0x19];
const SDK_VERSION = [0x06, 0x00, 0x03, 0x03];
export const STAGE_BROADCAST = 1;
export const STAGE_DIRECT = 2;

const ascii = (s: string) => new TextEncoder().encode(s);
const putU16 = (b: Uint8Array, o: number, v: number) => {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
};

/** go2rtc ConnectByUID, LAN stages only. */
export function connectByUID(stage: number, uid: string, sid8: Uint8Array): Uint8Array {
  const b = new Uint8Array(68);
  b.set([0x01, 0x06, 0x21], 8);
  b.set(SDK_VERSION, 52);
  b.set(sid8, 56);
  b[64] = stage;
  b.set(MAGIC, 0);
  b[3] = 0x02;
  putU16(b, 4, b.length - 16);
  b.set(ascii(uid).subarray(0, 20), 16);
  return b;
}

/** go2rtc ICAM: the Dafang/Xiaofang control-command envelope. */
export function icam(cmd: number, ...args: number[]): Uint8Array {
  const b = new Uint8Array(23 + args.length);
  b.set(ascii('ICAM'), 0);
  writeU32(b, 4, cmd);
  b[15] = args.length;
  b.set(args, 23);
  return b;
}

export const MSG_HDR = 28;
export const CMD_HDR = 24;

/** The parts of go2rtc's Session16 that build packets. Pure. */
export class Session16Packets {
  readonly sid16: Uint8Array;
  seqSendCmd = 0;
  private seqCh0 = 0;
  private seqCh1 = 0;

  constructor(sid8: Uint8Array) {
    this.sid16 = new Uint8Array(16);
    this.sid16.set(sid8, 8);
    this.sid16.set(sid8.subarray(0, 2), 0);
    this.sid16[4] = 0x0c;
  }

  msg(size: number): Uint8Array {
    const b = new Uint8Array(size);
    b.set(MAGIC, 0);
    b[3] = 0x0a;
    putU16(b, 4, size - 16);
    b.set([0x07, 0x04, 0x21], 8);
    b.set(this.sid16, 12);
    return b;
  }

  clientStart(i: number, username: string, password: string, nowMs: number): Uint8Array {
    const size = 566 + 32;
    const msg = this.msg(size);
    const cmd = MSG_HDR;
    msg.set([0x00, 0x00, 0x0b, 0x00], cmd);
    putU16(msg, cmd + 16, size - 52);
    if (i === 0) msg[cmd + 18] = 1;
    else msg[cmd + 1] = 0x20;
    writeU32(msg, cmd + 20, nowMs >>> 0);
    const data = cmd + CMD_HDR;
    msg.set(ascii(username), data);
    msg.set(ascii(password), data + 257);
    const cfg = data + 257 + 257;
    msg[cfg + 4] = 4;
    msg.set([0xfb, 0x07, 0x1f, 0x00], cfg + 8);
    msg[cfg + 22] = 3;
    return msg;
  }

  sendIOCtrl(ctrlType: number, ctrlData: Uint8Array, nowMs: number): Uint8Array {
    const dataSize = 4 + ctrlData.length;
    const msg = this.msg(MSG_HDR + CMD_HDR + dataSize);
    const cmd = MSG_HDR;
    msg.set([0x00, 0x70, 0x0b, 0x00], cmd);
    this.seqSendCmd++; // starts at 1 — "important!" per go2rtc
    putU16(msg, cmd + 4, this.seqSendCmd);
    putU16(msg, cmd + 16, dataSize);
    writeU32(msg, cmd + 20, nowMs >>> 0);
    writeU32(msg, cmd + CMD_HDR, ctrlType);
    msg.set(ctrlData, cmd + CMD_HDR + 4);
    return msg;
  }

  /** Ack for an incoming IOCtrl (0x0070). `cmd` starts at the 28-byte mark. */
  ack0070(cmd: Uint8Array): Uint8Array {
    const msg = this.msg(MSG_HDR + CMD_HDR);
    msg[MSG_HDR] = 0x00;
    msg[MSG_HDR + 1] = 0x71;
    msg.set(cmd.subarray(2, 6), MSG_HDR + 2);
    msg.set(cmd.subarray(20, 24), MSG_HDR + 20);
    return msg;
  }

  /** Ack for the Dafang-specific 0x0012 message. */
  ack0012(cmd: Uint8Array): Uint8Array {
    const dataSize = 20;
    const msg = this.msg(MSG_HDR + CMD_HDR + dataSize);
    msg.set([0x00, 0x13, 0x0b, 0x00], MSG_HDR);
    msg[MSG_HDR + 16] = dataSize;
    msg.set(cmd.subarray(CMD_HDR, CMD_HDR + dataSize), MSG_HDR + CMD_HDR);
    return msg;
  }

  /** go2rtc SessionWrite for channel 0: stamps the per-channel sequence. */
  stampCh0(buf: Uint8Array): Uint8Array {
    putU16(buf, 6, this.seqCh0);
    this.seqCh0 = (this.seqCh0 + 1) & 0xffff;
    return buf;
  }

  /** go2rtc SessionWrite for channel 1 (two-way audio): own sequence, channel byte. */
  stampCh1(buf: Uint8Array): Uint8Array {
    putU16(buf, 6, this.seqCh1);
    this.seqCh1 = (this.seqCh1 + 1) & 0xffff;
    buf[14] = 1;
    return buf;
  }

  // Channel 1 handshake. go2rtc: "answer on 0000 command with exact config
  // response", "send 0012 command at start", "respond on every 0008".

  ack0000(cmd: Uint8Array): Uint8Array {
    const dataSize = 32;
    const msg = this.msg(MSG_HDR + CMD_HDR + dataSize);
    msg.set([0x00, 0x14, 0x0b, 0x00], MSG_HDR);
    msg[MSG_HDR + 16] = dataSize;
    msg.set(cmd.subarray(20, 24), MSG_HDR + 20);
    msg.set(cmd.subarray(cmd.length - 32), MSG_HDR + CMD_HDR);
    return msg;
  }

  msg0012(): Uint8Array {
    const dataSize = 12;
    const msg = this.msg(MSG_HDR + CMD_HDR + dataSize);
    msg.set([0x00, 0x12, 0x0b, 0x00], MSG_HDR);
    msg[MSG_HDR + 16] = dataSize;
    const d = MSG_HDR + CMD_HDR;
    msg[d] = 2;
    msg[d + 4] = 1;
    msg[d + 9] = 1;
    return msg;
  }

  ack0007(): Uint8Array {
    const msg = this.msg(MSG_HDR + 28);
    msg.set([0x01, 0x0a, 0x0b, 0x00], MSG_HDR);
    msg[MSG_HDR + 20] = 1;
    return msg;
  }

  ack0008(cmd: Uint8Array): Uint8Array {
    const msg = this.msg(MSG_HDR + 28);
    msg.set([0x01, 0x09, 0x0b, 0x00], MSG_HDR);
    msg.set(cmd.subarray(20, 28), MSG_HDR + 20);
    return msg;
  }
}

/** Ping ack: go2rtc msgAckPing. */
export function ackPing(msg: Uint8Array): Uint8Array {
  const b = msg.slice();
  b[8] = 0x27;
  b[10] = 0x21;
  return b;
}

/** Channel-5 ack: go2rtc msgAckCh5. */
export function ackCh5(msg: Uint8Array): Uint8Array {
  const b = msg.slice();
  b[8] = 0x07;
  b[10] = 0x21;
  b[32] = 0x41;
  return b;
}

export const isConnectReply = (res: Uint8Array) =>
  res.length > 12 && res[8] === 0x02 && res[9] === 0x06 && res[10] === 0x12 && res[11] === 0x00;

export const isClientStartReply = (res: Uint8Array) =>
  res.length >= 84 && res[28] === 0 && (res[29] === 0x14 || res[29] === 0x21);

/** go2rtc connectDirect: [protocol, sdk a.b.c.d] from a 200-byte reply. */
export const versionFromReply = (res: Uint8Array): number[] => {
  const n = res.length;
  return [res[2], res[n - 13], res[n - 14], res[n - 15], res[n - 16]];
};
