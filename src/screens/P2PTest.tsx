import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCamera } from '../cameraStore';
import { cloudSession } from '../cloud/session';
import { type P2PKeys, fetchP2PKeys } from '../p2p/keys';
import { TutkConn } from '../p2p/tutkConn';
import { theme } from '../theme';

/**
 * One tap answers "can this camera do live view over P2P?" by running each
 * step of the connection and reporting how far it got. Nothing here plays
 * video yet; it only proves (or disproves) that frames arrive.
 */

type Status = 'pending' | 'running' | 'ok' | 'fail' | 'skipped';
interface Step {
  key: string;
  label: string;
  status: Status;
  detail: string;
}

const STEPS: [string, string][] = [
  ['session', 'Signed-in cloud session'],
  ['keys', 'P2P keys from the cloud'],
  ['connect', 'LAN hello on UDP 32761'],
  ['client', 'TUTK session login'],
  ['login', 'Dafang ICAM login'],
  ['frames', 'Video frames for 5 seconds'],
];

const fresh = (): Step[] => STEPS.map(([key, label]) => ({ key, label, status: 'pending', detail: '' }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const P2PTest: React.FC = () => {
  const camera = useCamera();
  const [steps, setSteps] = useState<Step[]>(fresh);
  const [running, setRunning] = useState(false);

  const set = (key: string, status: Status, detail = '') =>
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, status, detail } : s)));

  const skipRest = (from: string) =>
    setSteps(prev => {
      const i = prev.findIndex(s => s.key === from);
      return prev.map((s, j) => (j > i && s.status === 'pending' ? { ...s, status: 'skipped' } : s));
    });

  const run = async () => {
    setSteps(fresh());
    setRunning(true);
    let conn: TutkConn | null = null;
    let at = 'session';
    try {
      // 1. session + the cloud entry for this camera
      set('session', 'running');
      const cloud = cloudSession.get();
      if (!cloud.loggedIn) {
        throw new Error('Not signed in. Disconnect, then use "Sign in with Mi account" — this test needs that session.');
      }
      const entries = camera.deviceId === null ? [] : cloudSession.entriesFor(camera.deviceId);
      // The registration whose token the camera accepted is the live one.
      const entry = entries.find(e => e.token === camera.token) ?? entries[0];
      if (!entry) throw new Error(`The account lists no device with id ${camera.deviceId}.`);
      set('session', 'ok', `${entry.name}, did ${entry.did}, server ${entry.server}`);

      // 2. keys
      at = 'keys';
      set('keys', 'running');
      const keys: P2PKeys = await fetchP2PKeys(cloud, entry.server, entry.did);
      if (keys.format === 'miss') {
        set(
          'keys',
          'ok',
          `MISS format, ${keys.vendorName}, uid ${keys.uid || '—'}${keys.sign ? ', signed' : ''}`,
        );
        at = 'connect';
        throw new Error(
          'This camera uses the newer MISS format. The connection below is the legacy one; ' +
            'MISS is go2rtc pkg/xiaomi/miss and is the next thing to port.',
        );
      }
      set(
        'keys',
        'ok',
        `legacy format, uid ${keys.uid || '—'}, password ${keys.password ? `${keys.password.length} chars` : 'none'}` +
          (keys.sign ? ', signed (encrypted media)' : ''),
      );
      if (!keys.uid) throw new Error('The cloud returned no P2P uid.');

      // 3. LAN hello
      at = 'connect';
      set('connect', 'running');
      conn = new TutkConn(camera.ip, keys.uid);
      const v = await conn.connect().catch(e => {
        throw new Error(`${message(e)} — no TUTK reply from ${camera.ip}:32761`);
      });
      set('connect', 'ok', `protocol ${v[0]}, SDK ${v.slice(1).join('.')}`);

      // 4. session login
      at = 'client';
      set('client', 'running');
      await conn.clientStart();
      set('client', 'ok', 'accepted as admin');

      // 5. Dafang login
      at = 'login';
      set('login', 'running');
      await conn.dafangLogin(keys.password);
      set('login', 'ok', 'challenge answered');

      // 6. frames
      at = 'frames';
      set('frames', 'running', 'listening…');
      const st = await conn.collect(5000);
      if (st.frames === 0) {
        throw new Error(`nothing arrived (${conn.unknown} unrecognised packets)`);
      }
      set(
        'frames',
        'ok',
        `${st.frames} frames, ${(st.bytes / 1024).toFixed(0)} KB, ${st.keyframes} keyframes. ` +
          `First: ${st.firstPayload}; header ${st.firstHeader}`,
      );
    } catch (e) {
      set(at, 'fail', message(e));
      skipRest(at);
    } finally {
      conn?.close();
      setRunning(false);
    }
  };

  return (
    <View style={s.card}>
      <Text style={s.title}>P2P test</Text>
      <Text style={s.body}>
        Checks, step by step, whether this camera will stream video to the app — the same route Mi Home uses.
        Needs the Mi account session from this app run.
      </Text>

      {steps.map(st => (
        <View key={st.key} style={s.row}>
          <View style={s.mark}>
            {st.status === 'running' ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : (
              <Text style={[s.markText, { color: COLORS[st.status] }]}>{GLYPH[st.status]}</Text>
            )}
          </View>
          <View style={s.rowText}>
            <Text style={[s.label, st.status === 'skipped' && s.dim]}>{st.label}</Text>
            {!!st.detail && (
              <Text selectable style={[s.detail, st.status === 'fail' && s.failText]}>
                {st.detail}
              </Text>
            )}
          </View>
        </View>
      ))}

      <Pressable style={[s.button, running && s.buttonOff]} disabled={running} onPress={run}>
        <Text style={s.buttonText}>{running ? 'Running…' : 'Run P2P test'}</Text>
      </Pressable>
    </View>
  );
};

const GLYPH: Record<Status, string> = { pending: '○', running: '', ok: '✓', fail: '✕', skipped: '–' };
const COLORS: Record<Status, string> = {
  pending: theme.faint,
  running: theme.accent,
  ok: theme.good,
  fail: theme.bad,
  skipped: theme.faint,
};

const s = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderRadius: 12, padding: 16, marginBottom: 24, gap: 10 },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
  body: { color: theme.dim, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  mark: { width: 20, alignItems: 'center', paddingTop: 1 },
  markText: { fontSize: 15, fontWeight: '700' },
  rowText: { flex: 1 },
  label: { color: theme.text, fontSize: 14 },
  dim: { color: theme.faint },
  detail: { color: theme.dim, fontSize: 11, marginTop: 2, fontFamily: theme.mono, lineHeight: 16 },
  failText: { color: '#FFC9CC' },
  button: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: '#00201E', fontSize: 15, fontWeight: '700' },
});
