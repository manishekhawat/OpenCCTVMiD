import dgram from 'react-native-udp';

import {
  HELLO,
  MIIO_PORT,
  MiioCodec,
  type MiioHeader,
  disclosedToken,
  parseHeader,
} from './codec';

export class MiioError extends Error {
  readonly detail: unknown;

  constructor(detail: unknown) {
    super(`miIO error: ${JSON.stringify(detail)}`);
    this.detail = detail;
  }

  get methodAbsent(): boolean {
    const t = JSON.stringify(this.detail).toLowerCase();
    return t.includes('unsupported') || t.includes('-32601') || t.includes('unknown method');
  }

  /** The device rejected our arguments — which proves the method is real. */
  get methodExists(): boolean {
    const t = JSON.stringify(this.detail).toLowerCase();
    return !this.methodAbsent && (t.includes('-32602') || t.includes('invalid'));
  }
}

/**
 * Only the parts of react-native-udp's socket this file touches. Declared
 * structurally rather than deep-imported from the package's internal type
 * paths, which move between releases.
 */
interface UdpSocket {
  on(event: 'message', fn: (msg: Buffer, rinfo: { address: string; port: number }) => void): void;
  on(event: 'error', fn: (err: Error) => void): void;
  bind(port: number, callback?: () => void): void;
  send(
    msg: Buffer,
    offset: number,
    length: number,
    port: number,
    address: string,
    callback?: (error?: Error) => void,
  ): void;
  setBroadcast(flag: boolean): void;
  close(callback?: () => void): void;
}

export interface MiioResult {
  method: string;
  params: unknown[];
  value?: unknown;
  error?: unknown;
  elapsedMs: number;
}

type Listener = (data: Uint8Array) => void;

/** One UDP socket, bound once, shared by every request. */
export class MiioDevice {
  readonly ip: string;
  readonly port: number;
  readonly codec: MiioCodec;
  readonly timeoutMs: number;

  private socket: UdpSocket | null = null;
  private listeners = new Set<Listener>();

  deviceId = 0;
  private stampBase = 0;
  private stampAt: number | null = null;
  private requestId = 0;

  constructor(ip: string, token: string, port = MIIO_PORT, timeoutMs = 3000) {
    this.ip = ip;
    this.port = port;
    this.codec = MiioCodec.fromHex(token);
    this.timeoutMs = timeoutMs;
  }

  get connected(): boolean {
    return this.stampAt !== null;
  }

  /** The device clock, advanced locally so packets stay in its replay window. */
  get stamp(): number {
    if (this.stampAt === null) return 0;
    return this.stampBase + Math.floor((Date.now() - this.stampAt) / 1000);
  }

  private ensureSocket(): Promise<UdpSocket> {
    if (this.socket) return Promise.resolve(this.socket);
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4' });
      socket.on('message', (msg: Buffer) => {
        const bytes = new Uint8Array(msg);
        this.listeners.forEach(fn => fn(bytes));
      });
      socket.on('error', reject);
      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
        } catch {
          // Not fatal — only discovery needs it.
        }
        this.socket = socket;
        resolve(socket);
      });
    });
  }

  private waitFor(match: (data: Uint8Array) => boolean): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`no response from ${this.ip}`));
      }, this.timeoutMs);

      const listener: Listener = data => {
        if (!match(data)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(data);
      };
      this.listeners.add(listener);
    });
  }

  async handshake(): Promise<MiioHeader> {
    const socket = await this.ensureSocket();
    const reply = this.waitFor(() => true);
    socket.send(Buffer.from(HELLO), 0, HELLO.length, this.port, this.ip, () => {});

    const header = parseHeader(await reply);
    this.deviceId = header.deviceId;
    this.stampBase = header.stamp;
    this.stampAt = Date.now();
    return header;
  }

  async send(method: string, params: unknown[] = [], retries = 1): Promise<MiioResult> {
    const started = Date.now();
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (!this.connected) await this.handshake();
        const socket = await this.ensureSocket();

        this.requestId = (this.requestId % 9999) + 1;
        const id = this.requestId;
        const packet = this.codec.build(this.deviceId, this.stamp, { id, method, params });

        // A late reply to an already-timed-out request will arrive on the
        // next one, so match on the request id rather than taking the first
        // datagram that shows up.
        let decoded: Record<string, any> | null = null;
        const reply = this.waitFor(data => {
          try {
            const body = this.codec.read(data);
            if (!body || body.id !== id) return false;
            decoded = body;
            return true;
          } catch {
            return false;
          }
        });

        socket.send(Buffer.from(packet), 0, packet.length, this.port, this.ip, () => {});
        await reply;

        const response = decoded as unknown as Record<string, any>;
        if ('error' in response) throw new MiioError(response.error);
        return { method, params, value: response.result, elapsedMs: Date.now() - started };
      } catch (e) {
        // A MiioError is a real answer from the camera; retrying changes nothing.
        if (e instanceof MiioError) throw e;
        lastError = e;
        this.stampAt = null; // force a fresh handshake; the stamp may have drifted
      }
    }

    return {
      method,
      params,
      error: lastError ?? `no response from ${this.ip}`,
      elapsedMs: Date.now() - started,
    };
  }

  info(): Promise<MiioResult> {
    return this.send('miIO.info');
  }

  getProp(props: string[]): Promise<MiioResult> {
    return this.send('get_prop', props);
  }

  dispose(): void {
    this.listeners.clear();
    try {
      this.socket?.close();
    } catch {
      // Already closed.
    }
    this.socket = null;
    this.stampAt = null;
  }
}

export interface Discovered {
  ip: string;
  deviceId: number;
  token: string | null;
}

/** Broadcast a hello and collect whatever answers on the LAN. */
export function discover(windowMs = 4000): Promise<Discovered[]> {
  return new Promise(resolve => {
    const found = new Map<string, Discovered>();
    const socket = dgram.createSocket({ type: 'udp4' });

    socket.on('message', (msg: Buffer, rinfo: { address: string }) => {
      try {
        const header = parseHeader(new Uint8Array(msg));
        found.set(rinfo.address, {
          ip: rinfo.address,
          deviceId: header.deviceId,
          token: disclosedToken(header),
        });
      } catch {
        // Not a miIO device.
      }
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // Some platforms refuse without the right permission.
      }
      const payload = Buffer.from(HELLO);
      for (const target of ['255.255.255.255', '192.168.1.255', '192.168.0.255']) {
        socket.send(payload, 0, payload.length, MIIO_PORT, target, () => {});
      }
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        resolve(Array.from(found.values()));
      }, windowMs);
    });
  });
}
