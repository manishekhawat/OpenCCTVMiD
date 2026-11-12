import { cloudSession } from '../cloud/session';
import { fetchP2PKeys } from '../p2p/keys';
import { type Direction, type MissFrame, MissClient } from '../p2p/miss';

/**
 * Owns the one P2P connection to the camera: video for the live view and
 * pan/tilt on the same session. Opening a second session for each would
 * double the camera's load and its two streams would fight over bandwidth.
 *
 * Steps are the ones the P2P test proved on the real camera (2026-11-12):
 * cloud keys (MISS/TUTK) -> LAN hello -> session as "Miss" -> signed auth ->
 * Dafang video start.
 */

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'error';

export interface LiveState {
  status: LiveStatus;
  step: string;
  error: string;
  frames: number;
}

type Listener = (s: LiveState) => void;

export interface LiveTarget {
  ip: string;
  deviceId: number | null;
  token: string;
}

class LiveSession {
  private client: MissClient | null = null;
  private listeners = new Set<Listener>();
  private frameListener: ((f: MissFrame) => void) | null = null;
  private generation = 0;
  state: LiveState = { status: 'idle', step: '', error: '', frames: 0 };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn(this.state));
  }

  /** The player registers here; frames arrive decrypted. */
  onFrame(fn: ((f: MissFrame) => void) | null) {
    this.frameListener = fn;
  }

  get canStart(): boolean {
    return cloudSession.get().loggedIn;
  }

  async start(target: LiveTarget): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    const stale = () => gen !== this.generation;
    this.set({ status: 'connecting', step: 'Getting P2P keys…', error: '', frames: 0 });

    try {
      const cloud = cloudSession.get();
      if (!cloud.loggedIn) throw new Error('Sign in with your Mi account to use live view.');
      const entries = target.deviceId === null ? [] : cloudSession.entriesFor(target.deviceId);
      const entry = entries.find(e => e.token === target.token) ?? entries[0];
      if (!entry) throw new Error('The signed-in account does not list this camera.');

      const keys = await fetchP2PKeys(cloud, entry.server, entry.did);
      if (stale()) return;
      if (keys.format !== 'miss' || keys.vendor !== 1) {
        throw new Error(
          keys.format === 'miss'
            ? `This camera streams over ${keys.vendorName}, which isn't supported yet.`
            : 'This camera uses the legacy format, which live view does not support yet.',
        );
      }

      const c = new MissClient(target.ip, keys.uid, keys.devicePublic, keys.clientPrivate);
      this.client = c;
      c.onVideo = f => {
        this.state.frames++;
        this.frameListener?.(f);
      };

      this.set({ step: 'Connecting to the camera…' });
      await c.connect();
      if (stale()) return;
      await c.clientStart();
      if (stale()) return;
      this.set({ step: 'Logging in…' });
      await c.login(keys.clientPublic, keys.sign);
      if (stale()) return;
      this.set({ step: 'Starting video…' });
      await c.startVideo(false, false);
      if (stale()) return;
      this.set({ status: 'live', step: '' });
    } catch (e) {
      if (stale()) return;
      this.client?.close();
      this.client = null;
      this.set({ status: 'error', error: e instanceof Error ? e.message : String(e), step: '' });
    }
  }

  ptz(d: Direction): Promise<void> {
    if (!this.client || this.state.status !== 'live') return Promise.resolve();
    return this.client.ptz(d);
  }

  stop() {
    this.generation++;
    this.client?.close();
    this.client = null;
    if (this.state.status !== 'idle') this.set({ status: 'idle', step: '', error: '', frames: 0 });
  }
}

export const liveSession = new LiveSession();
