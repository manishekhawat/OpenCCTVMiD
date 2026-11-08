import React, { useEffect } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { describe, useCamera } from '../cameraStore';
import { type Candidate, signatureOf, verifiedProps } from '../commands';
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
  { key: 'calibrate', glyph: '⟳', label: 'Calibrate', locked: 'motors' },
  { key: 'power', glyph: '⏻', label: 'Camera off', locked: 'settings' },
  { key: 'night', glyph: '☾', label: 'Night mode', locked: 'settings' },
  { key: 'cloud', glyph: '☁', label: 'Storage', locked: 'cloud' },
];

const LOCK_REASON: Record<string, string> = {
  motors: 'Pan, tilt and calibration ride the P2P video channel. Every motor method was tried and the camera returned nothing.',
  settings: 'The camera acknowledges no write for this. set_power, set_night_mode and the motion-detection family all return silence.',
  cloud: 'Cloud storage is an account feature with no local endpoint.',
};

const PROP_LABELS: Record<string, (v: string) => string> = {
  power: v => (v === 'on' ? 'On' : v === 'off' ? 'Off' : v),
  night_mode: v => ({ '0': 'Off', '1': 'On', '2': 'Auto' }[v] ?? v),
  sdcard_status: v => ({ '0': 'No card', '1': 'Ready', '2': 'Error' }[v] ?? v),
};

export const ControlScreen: React.FC = () => {
  const camera = useCamera();

  useEffect(() => {
    void camera.refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTile = async (tile: Tile) => {
    if (tile.locked) {
      Alert.alert(`${tile.label} isn't available locally`, LOCK_REASON[tile.locked]);
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

      {/* Where the vendor app puts the live stream. There is no local stream,
          so the space states that plainly instead of showing a dead player. */}
      <View style={s.viewport}>
        <Text style={s.viewportGlyph}>⬚</Text>
        <Text style={s.viewportTitle}>No local video</Text>
        <Text style={s.viewportBody}>
          The stream is carried over Xiaomi's P2P channel, not RTSP. Nothing on the LAN can render
          it. Use the vendor app for the picture.
        </Text>
      </View>

      <View style={s.grid}>
        {TILES.map(tile => {
          const locked = Boolean(tile.locked);
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
