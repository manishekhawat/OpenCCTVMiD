import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCamera } from '../cameraStore';
import { cloudSession } from '../cloud/session';
import { type P2PKeys, fetchP2PKeys } from '../p2p/keys';
import { type Direction, MissClient } from '../p2p/miss';
import { TutkConn } from '../p2p/tutkConn';
import { theme } from '../theme';

/**
 * One tap answers "will this camera stream to the app, and will it move?"
 *
 * The first run (2026-11-12) showed the camera uses the MISS format over
 * TUTK. This runs that path: TUTK session as "Miss", the signed auth, the
 * Dafang video start, a 5-second frame count — and, if the session is up,
 * a press-and-hold pan/tilt pad on the same live connection.
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
  ['login', 'Camera login'],
  ['frames', 'Video for 5 seconds'],
];

const fresh = (): Step[] => STEPS.map(([key, label]) => ({ key, label, status: 'pending', detail: '' }));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const P2PTest: React.FC = () => {
  const camera = useCamera();
  const [steps, setSteps] = useState<Step[]>(fresh);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(false);
  const [ptzNote, setPtzNote] = useState('');
  const client = useRef<MissClient | null>(null);

  useEffect(() => () => client.current?.close(), []);

  const set = (key: string, status: Status, detail = '') =>
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, status, detail } : s)));

  const skipRest = (from: string) =>
    setSteps(prev => {
      const i = prev.findIndex(s => s.key === from);
      return prev.map((s, j) => (j > i && s.status === 'pending' ? { ...s, status: 'skipped' } : s));
    });

  const closeLive = () => {
    client.current?.close();
    client.current = null;
    setLive(false);
    setPtzNote('');
  };

  const run = async () => {
    closeLive();
    setSteps(fresh());
    setRunning(true);
    let at = 'session';
    let legacy: TutkConn | null = null;
    try {
      set('session', 'running');
      const cloud = cloudSession.get();
      if (!cloud.loggedIn) {
        throw new Error('Not signed in. Disconnect, then use "Sign in with Mi account" — this test needs that session.');
      }
      const entries = camera.deviceId === null ? [] : cloudSession.entriesFor(camera.deviceId);
      const entry = entries.find(e => e.token === camera.token) ?? entries[0];
      if (!entry) throw new Error(`The account lists no device with id ${camera.deviceId}.`);
      set('session', 'ok', `${entry.name}, did ${entry.did}, server ${entry.server}`);

      at = 'keys';
      set('keys', 'running');
      const keys: P2PKeys = await fetchP2PKeys(cloud, entry.server, entry.did);
      if (!keys.uid) throw new Error('The cloud returned no P2P uid.');

      if (keys.format === 'miss') {
        set('keys', 'ok', `MISS format, ${keys.vendorName}, uid ${keys.uid}${keys.sign ? ', signed' : ''}`);
        if (keys.vendor !== 1) {
          at = 'connect';
          throw new Error(`vendor ${keys.vendorName} is not TUTK; this build only speaks TUTK`);
        }
        if (!keys.devicePublic || !keys.sign) throw new Error('the cloud returned no device key or signature');

        const c = new MissClient(camera.ip, keys.uid, keys.devicePublic, keys.clientPrivate);
        client.current = c;

        at = 'connect';
        set('connect', 'running');
        const v = await c.connect().catch(e => {
          throw new Error(`${message(e)} — no TUTK reply from ${camera.ip}:32761`);
        });
        set('connect', 'ok', `protocol ${v[0]}, SDK ${v.slice(1).join('.')}`);

        at = 'client';
        set('client', 'running');
        await c.clientStart();
        set('client', 'ok', 'accepted as Miss');

        at = 'login';
        set('login', 'running');
        await c.login(keys.clientPublic, keys.sign);
        set('login', 'ok', 'MISS auth: success');

        // The session is up; pan/tilt doesn't depend on video working.
        setLive(true);

        at = 'frames';
        set('frames', 'running', 'starting video, listening…');
        await c.startVideo(false, false);
        await new Promise(r => setTimeout(r, 5000));
        const st = c.stats;
        if (st.video === 0) {
          throw new Error(
            `no video (${st.frames} packets: ${JSON.stringify(st.codecs)}, ${c.conn.unknown} unrecognised)`,
          );
        }
        set(
          'frames',
          'ok',
          `${st.video} video frames, ${st.keyframes} keyframes, codecs ${JSON.stringify(st.codecs)}. ` +
            `First: ${st.firstVideo}` + (st.firstKeyframe ? `. First keyframe: ${st.firstKeyframe}` : ''),
        );
      } else {
        // Legacy path, kept for older Dafang firmware.
        set('keys', 'ok', `legacy format, uid ${keys.uid}`);
        legacy = new TutkConn(camera.ip, keys.uid);
        at = 'connect';
        set('connect', 'running');
        const v = await legacy.connect();
        set('connect', 'ok', `protocol ${v[0]}`);
        at = 'client';
        set('client', 'running');
        await legacy.clientStart();
        set('client', 'ok', 'accepted as admin');
        at = 'login';
        set('login', 'running');
        await legacy.dafangLogin(keys.password);
        set('login', 'ok', 'ICAM challenge answered');
        at = 'frames';
        set('frames', 'running', 'listening…');
        const st = await legacy.collect(5000);
        if (!st.frames) throw new Error('nothing arrived');
        set('frames', 'ok', `${st.frames} frames, first ${st.firstPayload}`);
      }
    } catch (e) {
      set(at, 'fail', message(e));
      skipRest(at);
      if (at !== 'frames') closeLive();
    } finally {
      legacy?.close();
      setRunning(false);
    }
  };

  const press = (d: Direction) => {
    const c = client.current;
    if (!c) return;
    setPtzNote(`${d}…`);
    c.ptz(d).then(
      () => setPtzNote(`${d}: acknowledged`),
      e => setPtzNote(`${d}: ${message(e)}`),
    );
  };
  const release = () => {
    client.current?.ptz('stop').catch(() => {});
  };

  const Pad: React.FC<{ d: Direction; glyph: string }> = ({ d, glyph }) => (
    <Pressable style={({ pressed }) => [s.pad, pressed && s.padDown]} onPressIn={() => press(d)} onPressOut={release}>
      <Text style={s.padGlyph}>{glyph}</Text>
    </Pressable>
  );

  return (
    <View style={s.card}>
      <Text style={s.title}>P2P test</Text>
      <Text style={s.body}>
        Checks whether this camera will stream and move for the app, over the same route Mi Home uses. Needs
        the Mi account session from this app run.
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

      {live && (
        <View style={s.ptz}>
          <Text style={s.ptzTitle}>Pan / tilt — press and hold</Text>
          <Pad d="up" glyph="▲" />
          <View style={s.ptzRow}>
            <Pad d="left" glyph="◀" />
            <View style={s.ptzGap} />
            <Pad d="right" glyph="▶" />
          </View>
          <Pad d="down" glyph="▼" />
          {!!ptzNote && <Text style={s.detail}>{ptzNote}</Text>}
          <Pressable onPress={closeLive} hitSlop={10}>
            <Text style={s.link}>Close connection</Text>
          </Pressable>
        </View>
      )}

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
  ptz: { alignItems: 'center', gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border },
  ptzTitle: { color: theme.text, fontSize: 14, fontWeight: '600', marginBottom: 4 },
  ptzRow: { flexDirection: 'row', alignItems: 'center' },
  ptzGap: { width: 64 },
  pad: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: theme.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padDown: { backgroundColor: theme.accentDim },
  padGlyph: { color: theme.accent, fontSize: 22 },
  link: { color: theme.accent, fontSize: 13, marginTop: 6 },
  button: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: '#00201E', fontSize: 15, fontWeight: '700' },
});
