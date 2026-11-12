import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { describe, useCamera } from '../cameraStore';
import { type Candidate, signatureOf, verifiedProps } from '../commands';
import { LivePlayer } from '../live/LivePlayer';
import { type LiveState, liveSession } from '../live/session';
import type { Direction } from '../p2p/miss';
import { theme } from '../theme';

/**
 * Laid out in the idiom of the vendor app — dark surface, a tile grid of
 * controls, grouped setting rows — because that is the mental model the
 * camera's owner already has.
 *
 * What it deliberately does not copy: the vendor's logo and wordmarks, and
 * the pretence that every tile works. Tiles whose function rides the P2P
 * channel are drawn locked, with the reason, rather than drawn live and
 * failing on tap. A control that looks available and does nothing is worse
 * than one that explains itself.
 */

type Tile = {
  key: string;
  glyph: string;
  label: string;
  command?: Candidate;
  activeWhen?: string;
  locked?: string;
};

const TILES: Tile[] = [
  {
    key: 'track',
    glyph: '◎',
    label: 'Track',
    command: { method: 'set_track', params: ['on'], label: 'Track on', group: 'Confirmed' },
  },
  {
    key: 'cruise',
    glyph: '◴',
    label: 'Cruise',
    command: { method: 'set_cruise', params: ['on'], label: 'Cruise on', group: 'Confirmed' },
  },
  { key: 'pan', glyph: '✥', label: 'Pan / tilt', locked: 'motors' },
  { key: 'alarm', glyph: '◉', label: 'Motion alarm', locked: 'settings' },
  { key: 'calibrate', glyph: '⟳', label: 'Calibrate', locked: 'calibrate' },
  { key: 'power', glyph: '⏻', label: 'Camera off', locked: 'settings' },
  { key: 'night', glyph: '☾', label: 'Night mode', locked: 'settings' },
  { key: 'cloud', glyph: '☁', label: 'Storage', locked: 'cloud' },
];

const LOCK_REASON: Record<string, string> = {
  motors: 'Pan and tilt travel over the P2P channel with the video. Start live view above, then use the pad under the picture.',
  calibrate: 'Calibration is a P2P command too, but its bytes haven\'t been captured yet. Pan and tilt work in live view.',
  settings: 'The camera acknowledges no write for this. set_power, set_night_mode and the motion-detection family all return silence.',
  cloud: 'Cloud storage is an account feature with no local endpoint.',
  miio: "The camera's local-command service isn't answering, so Track and Cruise can't be sent. Unplug the camera for 10 seconds, then sign in again. Live view and pan/tilt are unaffected.",
};

const PROP_LABELS: Record<string, (v: string) => string> = {
  power: v => (v === 'on' ? 'On' : v === 'off' ? 'Off' : v),
  night_mode: v => ({ '0': 'Off', '1': 'On', '2': 'Auto' }[v] ?? v),
  sdcard_status: v => ({ '0': 'No card', '1': 'Ready', '2': 'Error' }[v] ?? v),
};

const PtzButton: React.FC<{ d: Direction; glyph: string }> = ({ d, glyph }) => (
  <Pressable
    style={({ pressed }) => [s.ptzButton, pressed && s.ptzDown]}
    onPressIn={() => void liveSession.ptz(d).catch(() => {})}
    onPressOut={() => void liveSession.ptz('stop').catch(() => {})}>
    <Text style={s.ptzGlyph}>{glyph}</Text>
  </Pressable>
);

export const ControlScreen: React.FC = () => {
  const camera = useCamera();
  const [live, setLive] = useState<LiveState>(liveSession.state);

  useEffect(() => {
    void camera.refreshState();
    const off = liveSession.subscribe(setLive);
    // Leaving the screen ends the stream: no one is watching, and the camera
    // should not keep sending video into the void.
    return () => {
      off();
      liveSession.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startLive = () =>
    void liveSession.start({ ip: camera.ip, deviceId: camera.deviceId, token: camera.token });

  const lockOf = (tile: Tile): string | undefined => {
    if (tile.key === 'pan') return live.status === 'live' ? undefined : tile.locked;
    if (tile.command && !camera.miioAvailable) return 'miio';
    return tile.locked;
  };

  const onTile = async (tile: Tile) => {
    if (tile.key === 'pan' && live.status === 'live') {
      Alert.alert('Pan / tilt', 'Press and hold the arrows under the picture.');
      return;
    }
    const lock = lockOf(tile);
    if (lock) {
      Alert.alert(`${tile.label} isn't available right now`, LOCK_REASON[lock]);
      return;
    }
    if (!tile.command) return;
    const result = await camera.call(tile.command.method, tile.command.params);
    if (result) {
      Alert.alert(signatureOf(tile.command), describe(result.error ?? result.value));
      void camera.refreshState();
    }
  };

  const info = camera.deviceInfo ?? {};

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <View style={s.titleBar}>
        <View>
          <Text style={s.title}>{String(info.model ?? 'Camera')}</Text>
          <Text style={s.subtitle}>
            {camera.ip} · fw {String(info.fw_ver ?? '?')}
          </Text>
        </View>
        <Pressable onPress={camera.disconnect} hitSlop={12}>
          <Text style={s.link}>Disconnect</Text>
        </Pressable>
      </View>

      {!camera.miioAvailable && (
        <View style={s.banner}>
          <Text style={s.bannerText}>
            Live-view-only mode: the camera's local-command service isn't answering, so Track, Cruise
            and status are unavailable. Unplugging the camera for 10 seconds brings them back.
          </Text>
        </View>
      )}

      {live.status === 'live' ? (
        <View style={s.liveBlock}>
          <LivePlayer />
          <View style={s.ptz}>
            <PtzButton d="up" glyph="▲" />
            <View style={s.ptzRow}>
              <PtzButton d="left" glyph="◀" />
              <Pressable onPress={() => liveSession.stop()} style={s.ptzStop} hitSlop={6}>
                <Text style={s.ptzStopText}>Stop</Text>
              </Pressable>
              <PtzButton d="right" glyph="▶" />
            </View>
            <PtzButton d="down" glyph="▼" />
          </View>
        </View>
      ) : (
        <View style={s.viewport}>
          {live.status === 'connecting' ? (
            <>
              <ActivityIndicator color={theme.accent} />
              <Text style={s.viewportBody}>{live.step}</Text>
            </>
          ) : liveSession.canStart ? (
            <>
              <Text style={s.viewportTitle}>Live view</Text>
              <Text style={s.viewportBody}>
                Video and pan/tilt over the camera's P2P channel — the same route Mi Home uses.
              </Text>
              {live.status === 'error' && <Text style={s.liveError}>{live.error}</Text>}
              <Pressable style={s.liveButton} onPress={startLive}>
                <Text style={s.liveButtonText}>{live.status === 'error' ? 'Try again' : 'Start live view'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.viewportGlyph}>⬚</Text>
              <Text style={s.viewportTitle}>Live view needs your Mi account</Text>
              <Text style={s.viewportBody}>
                The camera's P2P keys come from Xiaomi's cloud. Disconnect, then use "Sign in with Mi
                account"; the session lasts until the app closes.
              </Text>
            </>
          )}
        </View>
      )}

      <View style={s.grid}>
        {TILES.map(tile => {
          const locked = Boolean(lockOf(tile));
          return (
            <Pressable key={tile.key} style={s.tileWrap} onPress={() => onTile(tile)}>
              <View style={[s.tile, locked && s.tileLocked]}>
                <Text style={[s.tileGlyph, locked && s.tileGlyphLocked]}>{tile.glyph}</Text>
                {locked && <Text style={s.lockBadge}>✕</Text>}
              </View>
              <Text style={[s.tileLabel, locked && s.tileLabelLocked]} numberOfLines={1}>
                {tile.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>Status</Text>
        <Pressable onPress={() => camera.refreshState()} hitSlop={10}>
          <Text style={s.link}>{camera.refreshing ? 'Reading…' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <View style={s.list}>
        {verifiedProps.map(({ name, label }, i) => {
          const raw = camera.liveProps[name];
          const shown = raw === undefined ? '—' : (PROP_LABELS[name]?.(raw) ?? raw);
          return (
            <View key={name} style={[s.row, i === verifiedProps.length - 1 && s.rowLast]}>
              <Text style={s.rowLabel}>{label}</Text>
              <Text style={[s.rowValue, raw === undefined && s.rowValueMissing]}>{shown}</Text>
            </View>
          );
        })}
      </View>

      <Text style={s.footnote}>
        Read one property per call. This firmware omits unknown names from a batched reply rather
        than padding it, so a four-name request can return two values with no way to tell which.
      </Text>

      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>Stop</Text>
      </View>
      <View style={s.list}>
        <Pressable style={s.row} onPress={() => camera.call('set_track', ['off'])}>
          <Text style={s.rowLabel}>Turn tracking off</Text>
          <Text style={s.chevron}>›</Text>
        </Pressable>
        <Pressable style={[s.row, s.rowLast]} onPress={() => camera.call('set_cruise', ['off'])}>
          <Text style={s.rowLabel}>Turn cruise off</Text>
          <Text style={s.chevron}>›</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  content: { paddingBottom: 40 },

  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
  },
  title: { color: theme.text, fontSize: 17, fontWeight: '600' },
  subtitle: { color: theme.dim, fontSize: 12, marginTop: 3 },
  link: { color: theme.accent, fontSize: 13 },

  viewport: {
    marginHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#0E0E10',
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 30,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  viewportGlyph: { color: theme.faint, fontSize: 34, marginBottom: 10 },
  viewportTitle: { color: theme.text, fontSize: 15, fontWeight: '600', marginBottom: 6 },
  banner: { marginHorizontal: 14, marginBottom: 14, backgroundColor: '#2E2410', borderRadius: 10, padding: 12 },
  bannerText: { color: '#F5D58A', fontSize: 12, lineHeight: 18 },
  liveBlock: { marginHorizontal: 14, gap: 14 },
  liveError: { color: '#FFC9CC', fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  liveButton: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 22, marginTop: 14 },
  liveButtonText: { color: '#00201E', fontSize: 15, fontWeight: '700' },
  ptz: { alignItems: 'center', gap: 6 },
  ptzRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ptzButton: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#1C1C20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ptzDown: { backgroundColor: theme.accentDim },
  ptzGlyph: { color: theme.accent, fontSize: 22 },
  ptzStop: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  ptzStopText: { color: theme.faint, fontSize: 12 },
  viewportBody: { color: theme.dim, fontSize: 12, lineHeight: 18, textAlign: 'center' },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    paddingTop: 22,
  },
  tileWrap: { width: '25%', alignItems: 'center', marginBottom: 20 },
  tile: {
    width: 62,
    height: 62,
    borderRadius: 14,
    backgroundColor: '#1C1C20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLocked: { backgroundColor: '#121214' },
  tileGlyph: { color: theme.accent, fontSize: 25 },
  tileGlyphLocked: { color: '#3A3A40' },
  lockBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    color: '#4A4A52',
    fontSize: 10,
  },
  tileLabel: { color: theme.text, fontSize: 11, marginTop: 7 },
  tileLabelLocked: { color: '#4A4A52' },

  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    marginTop: 10,
    marginBottom: 10,
  },
  sectionTitle: { color: theme.dim, fontSize: 12, letterSpacing: 0.6 },

  list: { backgroundColor: '#121214', marginHorizontal: 14, borderRadius: 14 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#232328',
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { color: theme.text, fontSize: 15 },
  rowValue: { color: theme.dim, fontSize: 15 },
  rowValueMissing: { color: theme.faint },
  chevron: { color: theme.faint, fontSize: 20 },

  footnote: {
    color: theme.faint,
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 18,
    marginTop: 12,
  },
});
