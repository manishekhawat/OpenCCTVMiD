import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import {
  type Candidate,
  type Direction,
  candidateCommands,
  candidateProps,
  miotActionGrid,
  miotPropertyGrid,
  ptzByDirection,
  signatureOf,
  verifiedProps,
} from './commands';
import { MiioDevice, MiioError, type MiioResult } from './miio/device';
import { isEmptyResult } from './miio/result';

/**
 * 'ignored' rather than 'silent' or 'failed': this firmware returns nothing
 * at all for methods it does not implement, where a conforming miIO device
 * would answer unsupported_method. Silence here is the camera declining, not
 * the network dropping the packet — miIO.info answering in the same sweep is
 * what rules the network out.
 */
export type MethodStatus = 'untested' | 'works' | 'empty' | 'exists' | 'absent' | 'ignored';

export interface LogEntry {
  method: string;
  detail: string;
  ok: boolean;
  at: Date;
}

const KEY_IP = 'dafang.ip';
const KEY_TOKEN = 'dafang.token';
const KEY_FINDINGS = 'dafang.findings';

export interface CameraState {
  ip: string;
  token: string;
  connected: boolean;
  connecting: boolean;
  connectionError: string | null;
  deviceInfo: Record<string, any> | null;
  /** miIO device id from the handshake — the cloud's "did". */
  deviceId: number | null;
  findings: Record<string, MethodStatus>;
  liveProps: Record<string, string>;
  log: LogEntry[];
  refreshing: boolean;
  probing: boolean;
  probeDone: number;
  probeTotal: number;

  load(): Promise<void>;
  connect(ip: string, token: string): Promise<boolean>;
  disconnect(): void;
  call(method: string, params: unknown[]): Promise<MiioResult | null>;
  nudge(direction: Direction): Promise<boolean>;
  preferredPtz(direction: Direction): string | null;
  runProbe(includeActions?: boolean): Promise<void>;
  refreshState(): Promise<void>;
  confirmed: Candidate[];
}

const classify = (result: { error?: unknown; value?: unknown }): MethodStatus => {
  if (result.error) return 'ignored';
  return isEmptyResult(result.value) ? 'empty' : 'works';
};

const Ctx = createContext<CameraState | null>(null);

export const useCamera = (): CameraState => {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCamera used outside CameraProvider');
  return value;
};

/**
 * JSON.stringify(new Error('boom')) is "{}" — Error's own fields aren't
 * enumerable. Logging errors that way threw the reason away and showed empty
 * braces, which is exactly the information needed when a call fails.
 */
export const describe = (value: unknown): string => {
  if (value === undefined) return 'ok';
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const explain = (e: unknown): string => {
  const text = String(e);
  if (text.includes('checksum')) {
    return 'The camera replied but the token is wrong. Re-extract it — a token changes every time the camera is reset or re-added in Mi Home.';
  }
  if (text.includes('no response') || text.includes('timeout')) {
    return 'No reply on UDP 54321. Check the phone is on the same Wi-Fi (not mobile data), the camera is awake, and client isolation is off on the router.';
  }
  return text;
};

export const CameraProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const device = useRef<MiioDevice | null>(null);

  const [ip, setIp] = useState('192.168.1.11');
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<Record<string, any> | null>(null);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [findings, setFindings] = useState<Record<string, MethodStatus>>({});
  const [liveProps, setLiveProps] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeDone, setProbeDone] = useState(0);
  const [probeTotal, setProbeTotal] = useState(0);

  const note = useCallback((method: string, detail: string, ok: boolean) => {
    setLog(prev => [{ method, detail, ok, at: new Date() }, ...prev].slice(0, 300));
  }, []);

  const persist = useCallback(
    async (nextIp: string, nextToken: string, nextFindings: Record<string, MethodStatus>) => {
      await AsyncStorage.multiSet([
        [KEY_IP, nextIp],
        [KEY_TOKEN, nextToken],
        [KEY_FINDINGS, JSON.stringify(nextFindings)],
      ]);
    },
    [],
  );

  const load = useCallback(async () => {
    const entries = await AsyncStorage.multiGet([KEY_IP, KEY_TOKEN, KEY_FINDINGS]);
    const map = Object.fromEntries(entries);
    if (map[KEY_IP]) setIp(map[KEY_IP]!);
    if (map[KEY_TOKEN]) setToken(map[KEY_TOKEN]!);
    if (map[KEY_FINDINGS]) {
      try {
        setFindings(JSON.parse(map[KEY_FINDINGS]!));
      } catch {
        // Corrupt entry — start clean rather than crash on launch.
      }
    }
  }, []);

  /**
   * Reads the confirmed properties, one per call.
   *
   * Batching is tempting and wrong: get_prop omits names it doesn't know
   * rather than returning null for them, so a four-name request can come back
   * with two values and no way to tell which two. One name per call keeps the
   * mapping unambiguous.
   */
  const refreshState = useCallback(async (target?: MiioDevice) => {
    const dev = target ?? device.current;
    if (!dev || refreshing) return;
    setRefreshing(true);
    const next: Record<string, string> = {};
    for (const { name } of verifiedProps) {
      try {
        const result = await dev.getProp([name]);
        const value = Array.isArray(result.value) ? result.value[0] : undefined;
        if (value !== undefined && value !== null) next[name] = String(value);
      } catch {
        // Leave it out rather than showing a stale value as current.
      }
    }
    setLiveProps(prev => ({ ...prev, ...next }));
    setRefreshing(false);
  }, [refreshing]);

  const connect = useCallback(
    async (nextIp: string, nextToken: string): Promise<boolean> => {
      setConnecting(true);
      setConnectionError(null);
      device.current?.dispose();

      try {
        const dev = new MiioDevice(nextIp.trim(), nextToken.trim());
        await dev.handshake();
        const info = await dev.info();

        // The handshake needs no token, so surviving it only proves the camera
        // is online. miIO.info is the first call that actually uses the token,
        // which makes it the real credential check — and the app must not let
        // anyone past this point without it, or every later call fails for a
        // reason nothing on screen explains.
        if (info.error) {
          dev.dispose();
          setConnectionError(
            `The camera answered the handshake, so it is reachable at ${nextIp.trim()} — ` +
              `but it ignored the command sent with this token.\n\nFirst, unplug the camera for ` +
              `10 seconds and plug it back in. Its local-command service can get stuck after it ` +
              `rejoins Wi-Fi, and a restart has fixed exactly this before.\n\nIf that doesn't ` +
              `help, the token is wrong. Use Sign in with Mi account: it tests every token the ` +
              `account lists and keeps the one the camera answers to.`,
          );
          note('connect', describe(info.error), false);
          return false;
        }

        device.current = dev;
        setIp(nextIp.trim());
        setToken(nextToken.trim());
        setDeviceInfo(info.value as Record<string, any>);
        setDeviceId(dev.deviceId);
        setConnected(true);
        note('connect', `device_id ${dev.deviceId}`, true);
        await persist(nextIp.trim(), nextToken.trim(), findings);
        void refreshState(dev);
        return true;
      } catch (e) {
        setConnectionError(explain(e));
        note('connect', String(e), false);
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [findings, note, persist],
  );

  const disconnect = useCallback(() => {
    device.current?.dispose();
    device.current = null;
    setConnected(false);
    setDeviceInfo(null);
  }, []);

  const call = useCallback(
    async (method: string, params: unknown[]): Promise<MiioResult | null> => {
      const dev = device.current;
      if (!dev) return null;

      const signature = `${method}(${params.map(p => JSON.stringify(p)).join(', ')})`;
      try {
        const result = await dev.send(method, params);
        const status: MethodStatus = classify(result);
        setFindings(prev => {
          const next = { ...prev, [signature]: status };
          void persist(ip, token, next);
          return next;
        });
        note(signature, describe(result.error ?? result.value), !result.error);
        return result;
      } catch (e) {
        const status: MethodStatus = e instanceof MiioError && e.methodAbsent ? 'absent' : 'exists';
        setFindings(prev => {
          const next = { ...prev, [signature]: status };
          void persist(ip, token, next);
          return next;
        });
        const detail = e instanceof MiioError ? e.detail : e;
        note(signature, describe(detail), false);
        return { method, params, error: detail, elapsedMs: 0 };
      }
    },
    [ip, token, note, persist],
  );

  const preferredPtz = useCallback(
    (direction: Direction): string | null => {
      for (const c of ptzByDirection[direction]) {
        const sig = signatureOf(c);
        if (findings[sig] === 'works') return sig;
      }
      return null;
    },
    [findings],
  );

  const nudge = useCallback(
    async (direction: Direction): Promise<boolean> => {
      for (const c of ptzByDirection[direction]) {
        if (findings[signatureOf(c)] === 'absent') continue;
        const result = await call(c.method, c.params);
        if (result && !result.error) return true;
      }
      return false;
    },
    [call, findings],
  );

  const runProbe = useCallback(
    async (includeActions = false) => {
      const dev = device.current;
      if (!dev || probing) return;

      // The MIoT grids go in because the published spec for this model is
      // demonstrably incomplete — it lists neither get_prop nor set_cruise,
      // both of which answer. If a pan/tilt call exists locally at all, a
      // siid/piid grid is the only way left to find it.
      // Property reads are safe to sweep: get_properties only reads. Actions
      // are not — "action" invokes something, and on a device whose spec we
      // already know to be incomplete there is no way to know what siid 4
      // aiid 2 does before calling it. A factory reset would look exactly
      // like any other unknown action, so the grid stays behind an opt-in.
      const queue = [
        // Destructive candidates (sdcard_format) are never swept, under any
        // option. They used to ride along with the actions opt-in, so
        // agreeing to "sweep MIoT actions" also sent a format command.
        ...candidateCommands.filter(c => !c.destructive),
        ...miotPropertyGrid(),
        ...(includeActions ? miotActionGrid() : []),
      ];
      setProbing(true);
      setProbeDone(0);
      setProbeTotal(queue.length + candidateProps.length);

      const props: Record<string, string> = {};
      let done = 0;

      for (const name of candidateProps) {
        try {
          const result = await dev.getProp([name]);
          const value = Array.isArray(result.value) ? result.value[0] : undefined;
          if (value !== undefined && value !== null && value !== 'unsupport') {
            props[name] = String(value);
          }
        } catch {
          // Property not implemented.
        }
        setProbeDone(++done);
        await new Promise(r => setTimeout(r, 250));
      }
      setLiveProps(prev => ({ ...prev, ...props }));

      const results: Record<string, MethodStatus> = {};
      for (const c of queue) {
        const sig = signatureOf(c);
        try {
          const result = await dev.send(c.method, c.params, 0);
          results[sig] = classify(result);
        } catch (e) {
          results[sig] = e instanceof MiioError && e.methodAbsent ? 'absent' : 'exists';
        }
        setProbeDone(++done);
        await new Promise(r => setTimeout(r, 250));
      }

      setFindings(prev => {
        const next = { ...prev, ...results };
        void persist(ip, token, next);
        return next;
      });
      setProbing(false);
    },
    [ip, token, probing, persist],
  );

  const confirmed = useMemo(
    () => candidateCommands.filter(c => ['works', 'exists'].includes(findings[signatureOf(c)])),
    [findings],
  );

  const value: CameraState = {
    ip, token, connected, connecting, connectionError, deviceInfo, deviceId,
    findings, liveProps, log, refreshing, probing, probeDone, probeTotal,
    load, connect, disconnect, call, nudge, preferredPtz, runProbe, refreshState, confirmed,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
