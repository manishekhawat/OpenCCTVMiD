import { describePayload, TutkConn } from './tutkConn';
import { authRequest, dafangPtz, dafangQuality, dafangVideoStart, decode, type Direction, encode, sharedKey } from './missCodec';

export * from './missCodec';

/**
 * Xiaomi's "MISS" layer over TUTK — go2rtc pkg/xiaomi/miss/client.go and
 * pkg/xiaomi/crypto/crypto.go, for isa.camera.df3.
 *
 * The camera reports MISS format, TUTK vendor (2026-11-12 P2P test). The
 * transport is the same TUTK session as the legacy path; what changes is:
 *
 *   - session login as "Miss" / "client"
 *   - an auth command carrying our public key and the cloud's signature
 *   - every later command and every media payload encrypted with ChaCha20
 *     under a NaCl shared key (our private key x the camera's public key)
 *
 * The Dafang commands — video start, quality, and pan/tilt — are go2rtc's
 * dafangRaw: an ICAM command, hex-encoded, behind 7f ff ff ff. go2rtc keeps
 * the pan/tilt ones commented out (it has no PTZ UI); they were captured from
 * a real df3.
 */

const CMD_AUTH_REQ = 0x100;
const CMD_ENCODED = 0x1001;

// --- media --------------------------------------------------------------------

export interface MissStats {
  frames: number;
  video: number;
  audio: number;
  codecs: Record<string, number>;
  firstVideo: string;
  keyframes: number;
  decodeErrors: number;
}

const codecName = (id: number) =>
  ({ 4: 'H.264', 5: 'H.265', 1024: 'PCM', 1026: 'PCMU', 1027: 'PCMA', 1032: 'Opus' } as Record<number, string>)[id] ??
  `codec ${id}`;

export interface MissFrame {
  codec: number;
  payload: Uint8Array;
}

// --- client -------------------------------------------------------------------

export class MissClient {
  readonly conn: TutkConn;
  private readonly key: Uint8Array;
  stats: MissStats = { frames: 0, video: 0, audio: 0, codecs: {}, firstVideo: '', keyframes: 0, decodeErrors: 0 };
  onVideo: ((f: MissFrame) => void) | null = null;

  constructor(ip: string, uid: string, devicePublic: string, clientPrivate: string) {
    this.conn = new TutkConn(ip, uid);
    this.key = sharedKey(devicePublic, clientPrivate);
    this.conn.onFrame = (hdr, payload) => this.frame(hdr, payload);
  }

  connect() {
    return this.conn.connect();
  }

  clientStart() {
    return this.conn.clientStart('Miss', 'client');
  }

  /** go2rtc miss login: the reply must say "result":"success". */
  async login(clientPublic: string, sign: string): Promise<void> {
    await this.conn.writeCommand(CMD_AUTH_REQ, authRequest(clientPublic, sign));
    const reply = await this.conn.readCommand();
    const text = new TextDecoder().decode(reply.data);
    if (!text.includes('"result":"success"')) throw new Error(`auth rejected: ${text.slice(0, 120)}`);
  }

  /** go2rtc Client.WriteCommand: encrypt, send as 0x1001. */
  command(data: Uint8Array) {
    return this.conn.writeCommand(CMD_ENCODED, encode(data, this.key));
  }

  /** go2rtc StartMedia for the Dafang: quality, then start. */
  async startVideo(sd = false, audio = false) {
    await this.command(dafangQuality(sd));
    await this.command(dafangVideoStart(audio));
  }

  ptz(d: Direction, speed = 5) {
    return this.command(dafangPtz(d, speed));
  }

  private frame(hdr: Uint8Array, payload: Uint8Array) {
    const st = this.stats;
    st.frames++;
    if (hdr.length < 32 || payload.length < 8) {
      st.decodeErrors++;
      return;
    }
    const codec = (hdr[4] | (hdr[5] << 8) | (hdr[6] << 16) | (hdr[7] << 24)) >>> 0;
    const name = codecName(codec);
    st.codecs[name] = (st.codecs[name] ?? 0) + 1;
    const plain = decode(payload, this.key);
    if (codec === 4 || codec === 5) {
      st.video++;
      const kind = describePayload(plain);
      if (!st.firstVideo) st.firstVideo = kind;
      if (/SPS|VPS|IDR/.test(kind)) st.keyframes++;
      this.onVideo?.({ codec, payload: plain });
    } else {
      st.audio++;
    }
  }

  close() {
    this.conn.close();
  }
}
