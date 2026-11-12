import dgram from 'react-native-udp';

import {
  CMD_HDR,
  STAGE_BROADCAST,
  STAGE_DIRECT,
  Session16Packets,
  ackCh5,
  ackPing,
  connectByUID,
  icam,
  isClientStartReply,
  isConnectReply,
  reverseTransCode,
  transCode,
  versionFromReply,
  xxteaDecrypt16,
} from './tutkCodec';

/**
 * A TUTK session over the LAN — go2rtc pkg/tutk conn.go + session0.go +
 * session16.go, and the Dafang login from pkg/xiaomi/legacy/client.go.
 *
 * Covers the protocol-16 session only. go2rtc switches to its session-25
 * implementation when the camera reports protocol 25 or later; if this camera
 * does, connect() says so instead of guessing.
 */

const LAN_PORT = 32761;

interface UdpSocket {
  on(event: 'message', fn: (msg: Buffer, rinfo: { address: string; port: number }) => void): void;
  on(event: 'error', fn: (err: Error) => void): void;
  bind(port: number, cb?: () => void): void;
  send(msg: Buffer, offset: number, length: number, port: number, address: string, cb?: (e?: Error) => void): void;
  close(cb?: () => void): void;
}

export interface FrameStats {
  frames: number;
  bytes: number;
  /** First bytes of the first frame's header (FrameInfo), hex. */
  firstHeader: string;
  /** What the first payload looks like: "H.264 SPS", "H.265 VPS", or raw hex. */
  firstPayload: string;
  keyframes: number;
}

const hex = (b: Uint8Array, n = 24) => Array.from(b.subarray(0, n), x => x.toString(16).padStart(2, '0')).join('');

/** Names the first NAL unit if the payload is Annex-B video. */
export function describePayload(p: Uint8Array): string {
  const start = p[0] === 0 && p[1] === 0 && (p[2] === 1 ? 3 : p[2] === 0 && p[3] === 1 ? 4 : 0);
  if (!start) return `raw ${hex(p, 12)}`;
  const b = p[start];
  const h264 = b & 0x1f;
  const h265 = (b >> 1) & 0x3f;
  if (h265 === 32) return 'H.265 VPS';
  if (h264 === 7) return 'H.264 SPS';
  if (h264 === 5) return 'H.264 IDR';
  if (h264 === 1) return 'H.264 slice';
  return `Annex-B NAL ${b.toString(16)}`;
}

export class TutkConn {
  private socket: UdpSocket | null = null;
  private port = LAN_PORT;
  private readonly sid8: Uint8Array;
  private readonly s: Session16Packets;
  private waiters: ((m: Uint8Array) => boolean)[] = [];
  private commands: Uint8Array[] = [];
  private commandWaiter: (() => void) | null = null;
  private commandAck: (() => void) | null = null;

  // chunked-frame reassembly (go2rtc Session16.SessionRead 0x0103)
  private waitFSeq = 0;
  private waitCSeq = 0;
  private waitSize = 0;
  private waitData: number[] = [];

  version: number[] = [];
  stats: FrameStats = { frames: 0, bytes: 0, firstHeader: '', firstPayload: '', keyframes: 0 };
  unknown = 0;

  constructor(readonly ip: string, readonly uid: string) {
    this.sid8 = new Uint8Array(8);
    // go2rtc GenSessionID: unix nanos, little endian. Uniqueness is all it needs.
    const now = Date.now();
    for (let i = 0; i < 8; i++) this.sid8[i] = Math.floor(now / 2 ** (8 * i)) & 0xff;
    this.s = new Session16Packets(this.sid8);
  }

  // --- socket ---------------------------------------------------------------

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4' }) as unknown as UdpSocket;
      sock.on('error', reject);
      sock.on('message', (raw, rinfo) => {
        if (rinfo.address !== this.ip || raw.length < 16) return;
        // The camera answers the LAN-port hello from its session port.
        if (rinfo.port !== this.port) this.port = rinfo.port;
        this.receive(reverseTransCode(new Uint8Array(raw)));
      });
      sock.bind(0, () => {
        this.socket = sock;
        resolve();
      });
    });
  }

  private write(b: Uint8Array) {
    const out = Buffer.from(transCode(b));
    this.socket?.send(out, 0, out.length, this.port, this.ip);
  }

  private ch0(b: Uint8Array) {
    this.write(this.s.stampCh0(b));
  }

  private ch1(b: Uint8Array) {
    this.write(this.s.stampCh1(b));
  }

  /** go2rtc writeAndWait: resend every second until a reply matches. */
  private writeAndWait(ok: (m: Uint8Array) => boolean, timeoutMs: number, ...req: Uint8Array[]): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const send = () => req.forEach(b => this.write(b));
      const tick = setInterval(send, 1000);
      const timer = setTimeout(() => {
        clearInterval(tick);
        this.waiters = this.waiters.filter(w => w !== waiter);
        reject(new Error('timeout'));
      }, timeoutMs);
      const waiter = (m: Uint8Array) => {
        if (!ok(m)) return false;
        clearInterval(tick);
        clearTimeout(timer);
        resolve(m);
        return true;
      };
      this.waiters.push(waiter);
      send();
    });
  }

  // --- receive (go2rtc Conn.handleMsg + Session16.SessionRead) ---------------

  private receive(msg: Uint8Array) {
    for (const w of [...this.waiters]) {
      if (w(msg)) {
        this.waiters = this.waiters.filter(x => x !== w);
        return;
      }
    }
    if (msg[8] === 0x08) {
      const ch = msg[14];
      if (ch === 0) return this.sessionRead0(msg.subarray(28));
      if (ch === 1) return this.sessionRead1(msg.subarray(28));
      if (ch === 5 && msg.length === 48) return this.write(ackCh5(msg));
      return;
    }
    if (msg[8] === 0x28 && msg.length === 24) return this.write(ackPing(msg));
    this.unknown++;
  }

  private sessionRead0(cmd: Uint8Array) {
    if (cmd[0] === 0x01 && cmd[1] === 0x03) return this.mediaChunk(cmd);
    if (cmd[0] === 0x01 && cmd[1] === 0x04) {
      const hdrSize = cmd[14] | (cmd[15] << 8);
      const data = cmd.subarray(CMD_HDR);
      return this.frame(data.subarray(0, hdrSize), data.subarray(hdrSize));
    }
    if (cmd[0] === 0x00 && cmd[1] === 0x70) {
      this.ch0(this.s.ack0070(cmd));
      this.commands.push(cmd.slice(CMD_HDR));
      this.commandWaiter?.();
      return;
    }
    if (cmd[0] === 0x00 && cmd[1] === 0x12) return this.ch0(this.s.ack0012(cmd));
    if (cmd[0] === 0x00 && cmd[1] === 0x71) return this.commandAck?.();
    this.unknown++;
  }

  private sessionRead1(cmd: Uint8Array) {
    if (cmd[0] === 0x00 && cmd[1] === 0x00) {
      this.ch1(this.s.ack0000(cmd));
      this.ch1(this.s.msg0012());
    } else if (cmd[0] === 0x00 && cmd[1] === 0x07) this.ch1(this.s.ack0007());
    else if (cmd[0] === 0x00 && cmd[1] === 0x08) this.ch1(this.s.ack0008(cmd));
  }

  private mediaChunk(cmd: Uint8Array) {
    const frameSeq = cmd[4] | (cmd[5] << 8);
    const chunkSeq = cmd[12] | (cmd[13] << 8);
    const payloadSize = (cmd[8] | (cmd[9] << 8) | (cmd[10] << 16) | (cmd[11] << 24)) >>> 0;
    if (chunkSeq === 0) {
      this.waitFSeq = frameSeq;
      this.waitCSeq = 0;
      this.waitData = [];
      this.waitSize = (cmd[14] | (cmd[15] << 8)) + payloadSize;
    } else if (frameSeq !== this.waitFSeq || chunkSeq !== this.waitCSeq) {
      this.waitCSeq = 0;
      return; // lost chunk: drop the frame
    }
    for (const b of cmd.subarray(CMD_HDR)) this.waitData.push(b);
    if (this.waitData.length < this.waitSize) {
      this.waitCSeq++;
      return;
    }
    this.waitCSeq = 0;
    const all = Uint8Array.from(this.waitData);
    this.frame(all.subarray(payloadSize), all.subarray(0, payloadSize));
  }

  private frame(header: Uint8Array, payload: Uint8Array) {
    const st = this.stats;
    if (st.frames === 0) {
      st.firstHeader = hex(header, 16);
      st.firstPayload = describePayload(payload);
    }
    st.frames++;
    st.bytes += payload.length;
    const kind = describePayload(payload);
    if (kind.includes('SPS') || kind.includes('VPS') || kind.includes('IDR')) st.keyframes++;
  }

  // --- commands (go2rtc Conn.WriteCommand / ReadCommand) ---------------------

  async writeCommand(ctrlType: number, data: Uint8Array): Promise<void> {
    const buf = this.s.sendIOCtrl(ctrlType, data, Date.now());
    for (let attempt = 0; attempt < 5; attempt++) {
      const acked = new Promise<boolean>(resolve => {
        const t = setTimeout(() => resolve(false), 1000);
        this.commandAck = () => {
          clearTimeout(t);
          resolve(true);
        };
      });
      this.ch0(buf.slice());
      if (await acked) {
        this.commandAck = null;
        return;
      }
    }
    this.commandAck = null;
    throw new Error(`command 0x${ctrlType.toString(16)} was never acknowledged`);
  }

  async readCommand(timeoutMs = 5000): Promise<{ type: number; data: Uint8Array }> {
    if (!this.commands.length) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          this.commandWaiter = null;
          reject(new Error('no command reply from the camera'));
        }, timeoutMs);
        this.commandWaiter = () => {
          clearTimeout(t);
          this.commandWaiter = null;
          resolve();
        };
      });
    }
    const buf = this.commands.shift()!;
    const type = (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
    return { type, data: buf.subarray(4) };
  }

  // --- the steps the P2P test reports one by one -----------------------------

  /** Stage 1+2: LAN hello on UDP 32761, then "direct". Returns the protocol version. */
  async connect(): Promise<number[]> {
    await this.open();
    const res = await this.writeAndWait(isConnectReply, 5000, connectByUID(STAGE_BROADCAST, this.uid, this.sid8));
    this.version = versionFromReply(res);
    this.write(connectByUID(STAGE_DIRECT, this.uid, this.sid8));
    return this.version;
  }

  /** Session login. For the Dafang the account is "admin" with no password here. */
  async clientStart(username = 'admin', password = ''): Promise<void> {
    if (this.version[0] >= 25) {
      throw new Error(
        `camera speaks TUTK protocol ${this.version[0]}; this build only implements protocol 16 ` +
          `(go2rtc has a separate session-25 implementation to port)`,
      );
    }
    // Sent raw, not through the channel-0 sequence: go2rtc's clientStart
    // writes these with conn.Write, so their sequence bytes stay zero and the
    // session's own numbering starts at 0 afterwards.
    const now = Date.now();
    await this.writeAndWait(
      isClientStartReply,
      5000,
      this.s.clientStart(0, username, password, now),
      this.s.clientStart(1, username, password, now),
    );
  }

  /**
   * The Dafang's own login, go2rtc legacy/client.go xiaofangLogin: ask for a
   * challenge, decrypt it with the devicepass password (XXTEA), send it back.
   */
  async dafangLogin(password: string): Promise<void> {
    await this.writeCommand(0x0100, icam(0x0400be));
    const challenge = await this.readCommand();
    const enc = challenge.data.slice(24);
    if (enc.length < 16) throw new Error(`login challenge too short (${enc.length} bytes)`);

    const key = new Uint8Array(16);
    key.set(new TextEncoder().encode(password).subarray(0, 16));
    const dec = xxteaDecrypt16(enc.subarray(0, 16), key);
    const answer = [...dec, ...enc.subarray(16), 0, 0, 0, 0, 1, 1, 1];

    await this.writeCommand(0x0100, icam(0x0400c0, ...answer));
    await this.readCommand();
  }

  /** Waits and counts whatever media arrives. The Dafang streams unprompted. */
  async collect(ms: number): Promise<FrameStats> {
    await new Promise(r => setTimeout(r, ms));
    return { ...this.stats };
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = null;
  }
}
