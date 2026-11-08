import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import {
  type Candidate,
  type Direction,
  candidateCommands,
  candidateProps,
  ptzByDirection,
  signatureOf,
} from './commands';
import { MiioDevice, MiioError, type MiioResult } from './miio/device';

export type MethodStatus = 'untested' | 'works' | 'exists' | 'absent' | 'silent';

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
  findings: Record<string, MethodStatus>;
  liveProps: Record<string, string>;
  log: LogEntry[];
  probing: boolean;
  probeDone: number;
  probeTotal: number;

  load(): Promise<void>;
  connect(ip: string, token: string): Promise<boolean>;
  disconnect(): void;
  call(method: string, params: unknown[]): Promise<MiioResult | null>;
  nudge(direction: Direction): Promise<boolean>;
  preferredPtz(direction: Direction): string | null;
  runProbe(includeDestructive?: boolean): Promise<void>;
  confirmed: Candidate[];
}

const Ctx = createContext<CameraState | null>(null);

export const useCamera = (): CameraState => {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCamera used outside CameraProvider');
  return value;
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
  const [findings, setFindings] = useState<Record<string, MethodStatus>>({});
  const [liveProps, setLiveProps] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
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

  const connect = useCallback(
    async (nextIp: string, nextToken: string): Promise<boolean> => {
      setConnecting(true);
      setConnectionError(null);
      device.current?.dispose();

      try {
        const dev = new MiioDevice(nextIp.trim(), nextToken.trim());
        await dev.handshake();
        const info = await dev.info();

        device.current = dev;
        setIp(nextIp.trim());
        setToken(nextToken.trim());
        setConnected(true);

        if (info.error) {
          setConnectionError('Handshake worked but miIO.info failed — the token is probably wrong for this camera.');
          note('connect', String(info.error), false);
        } else {
          setDeviceInfo(info.value as Record<string, any>);
          note('connect', `device_id ${dev.deviceId}`, true);
        }
        await persist(nextIp.trim(), nextToken.trim(), findings);
        return !info.error;
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
        const status: MethodStatus = result.error ? 'silent' : 'works';
        setFindings(prev => {
          const next = { ...prev, [signature]: status };
          void persist(ip, token, next);
          return next;
        });
        note(signature, JSON.stringify(result.error ?? result.value), !result.error);
        return result;
      } catch (e) {
        const status: MethodStatus = e instanceof MiioError && e.methodAbsent ? 'absent' : 'exists';
        setFindings(prev => {
          const next = { ...prev, [signature]: status };
          void persist(ip, token, next);
          return next;
        });
        const detail = e instanceof MiioError ? e.detail : e;
        note(signature, JSON.stringify(detail), false);
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
    async (includeDestructive = false) => {
      const dev = device.current;
      if (!dev || probing) return;

      const queue = candidateCommands.filter(c => includeDestructive || !c.destructive);
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
      setLiveProps(props);

      const results: Record<string, MethodStatus> = {};
      for (const c of queue) {
        const sig = signatureOf(c);
        try {
          const result = await dev.send(c.method, c.params, 0);
          results[sig] = result.error ? 'silent' : 'works';
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
    ip, token, connected, connecting, connectionError, deviceInfo,
    findings, liveProps, log, probing, probeDone, probeTotal,
    load, connect, disconnect, call, nudge, preferredPtz, runProbe, confirmed,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
