import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCamera } from '../cameraStore';
import { type Candidate, type Direction, signatureOf } from '../commands';
import { theme } from '../theme';

const PtzPad: React.FC = () => {
  const camera = useCamera();
  const [busy, setBusy] = useState<Direction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const go = async (direction: Direction) => {
    setBusy(direction);
    setMessage(null);
    const ok = await camera.nudge(direction);
    setBusy(null);
    if (!ok) {
      setMessage(
        `No motor command accepted for "${direction}". Run the probe first, or this firmware may keep PTZ on the P2P channel only.`,
      );
    }
  };

  const Btn: React.FC<{ direction: Direction; glyph: string }> = ({ direction, glyph }) => {
    const known = camera.preferredPtz(direction) !== null;
    return (
      <Pressable
        style={[s.padButton, known && s.padKnown, busy !== null && s.padBusy]}
        disabled={busy !== null}
        onPress={() => go(direction)}>
        {busy === direction ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <Text style={s.padGlyph}>{glyph}</Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={s.pad}>
      <Btn direction="up" glyph="▲" />
      <View style={s.padRow}>
        <Btn direction="left" glyph="◀" />
        <View style={s.padSpacer} />
        <Btn direction="right" glyph="▶" />
      </View>
      <Btn direction="down" glyph="▼" />
      {message && <Text style={s.padMessage}>{message}</Text>}
    </View>
  );
};

export const ControlScreen: React.FC = () => {
  const camera = useCamera();

  const groups = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    for (const c of camera.confirmed) {
      map.set(c.group, [...(map.get(c.group) ?? []), c]);
    }
    return Array.from(map.entries());
  }, [camera.confirmed]);

  const fire = (c: Candidate) => {
    const run = async () => {
      const result = await camera.call(c.method, c.params);
      if (!result) return;
      Alert.alert(
        signatureOf(c),
        result.error ? String(JSON.stringify(result.error)) : String(JSON.stringify(result.value)),
      );
    };
    if (c.destructive) {
      Alert.alert(c.label, `${signatureOf(c)}\n\nThis cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run it', style: 'destructive', onPress: run },
      ]);
    } else {
      void run();
    }
  };

  const info = camera.deviceInfo ?? {};

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <View style={s.header}>
        <View style={s.dot} />
        <View style={s.headerText}>
          <Text style={s.model}>{String(info.model ?? 'camera')}</Text>
          <Text style={s.meta}>
            {camera.ip} · fw {String(info.fw_ver ?? '?')}
          </Text>
        </View>
        <Pressable onPress={camera.disconnect} hitSlop={12}>
          <Text style={s.link}>Disconnect</Text>
        </Pressable>
      </View>

      <PtzPad />

      {camera.confirmed.length === 0 ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>No commands confirmed yet</Text>
          <Text style={s.cardBody}>
            Xiaomi never published the method list for this camera, so the app has to ask yours what
            it understands. Run the sweep on the Probe tab; whatever answers shows up here.
          </Text>
        </View>
      ) : (
        groups.map(([group, items]) => (
          <View key={group} style={s.group}>
            <Text style={s.groupLabel}>{group.toUpperCase()}</Text>
            <View style={s.chips}>
              {items.map(c => (
                <Pressable
                  key={signatureOf(c)}
                  style={[s.chip, c.destructive && s.chipDanger]}
                  onPress={() => fire(c)}>
                  <Text style={[s.chipText, c.destructive && s.chipDangerText]}>
                    {c.destructive ? `⚠ ${c.label}` : c.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}

      {Object.keys(camera.liveProps).length > 0 && (
        <View style={s.group}>
          <Text style={s.groupLabel}>REPORTED STATE</Text>
          <View style={s.chips}>
            {Object.entries(camera.liveProps).map(([k, v]) => (
              <View key={k} style={s.propChip}>
                <Text style={s.propText}>
                  {k}: {v}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.good, marginRight: 10 },
  headerText: { flex: 1 },
  model: { color: theme.text, fontSize: 16, fontWeight: '600' },
  meta: { color: theme.dim, fontSize: 12, marginTop: 2 },
  link: { color: theme.accent, fontSize: 13 },

  pad: { alignItems: 'center', marginBottom: 28 },
  padRow: { flexDirection: 'row', alignItems: 'center' },
  padSpacer: { width: 56 },
  padButton: {
    width: 64,
    height: 64,
    margin: 4,
    borderRadius: 16,
    backgroundColor: theme.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padKnown: { backgroundColor: theme.accentDim },
  padBusy: { opacity: 0.6 },
  padGlyph: { color: theme.text, fontSize: 20 },
  padMessage: { color: theme.bad, fontSize: 12, textAlign: 'center', marginTop: 12, lineHeight: 18 },

  card: { backgroundColor: theme.surface, borderRadius: 12, padding: 16 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '600', marginBottom: 8 },
  cardBody: { color: theme.dim, fontSize: 13, lineHeight: 20 },

  group: { marginBottom: 22 },
  groupLabel: { color: theme.dim, fontSize: 11, letterSpacing: 1.2, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipDanger: { backgroundColor: '#3A1618' },
  chipText: { color: theme.text, fontSize: 13 },
  chipDangerText: { color: '#FFC9CC' },
  propChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  propText: { color: theme.dim, fontSize: 12, fontFamily: theme.mono },
});
