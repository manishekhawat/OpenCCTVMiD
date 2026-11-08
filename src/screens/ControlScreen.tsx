import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { describe, useCamera } from '../cameraStore';
import { type Candidate, signatureOf, verifiedCommands, verifiedProps } from '../commands';
import { theme } from '../theme';

const PROP_LABELS: Record<string, (v: string) => string> = {
  power: v => (v === 'on' ? 'On' : v === 'off' ? 'Off' : v),
  night_mode: v => ({ '0': 'Off', '1': 'On', '2': 'Auto' }[v] ?? v),
  sdcard_status: v => ({ '0': 'None', '1': 'Ready', '2': 'Error' }[v] ?? v),
};

export const ControlScreen: React.FC = () => {
  const camera = useCamera();

  useEffect(() => {
    void camera.refreshState();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discovered = useMemo(() => {
    const seen = new Set(verifiedCommands.map(signatureOf));
    return camera.confirmed.filter(c => !seen.has(signatureOf(c)));
  }, [camera.confirmed]);

  const fire = (c: Candidate) => {
    const run = async () => {
      const result = await camera.call(c.method, c.params);
      if (!result) return;
      Alert.alert(signatureOf(c), describe(result.error ?? result.value));
      void camera.refreshState();
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

      <View style={s.stateHead}>
        <Text style={s.groupLabel}>STATE</Text>
        <Pressable onPress={() => camera.refreshState()} hitSlop={10}>
          {camera.refreshing ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <Text style={s.link}>Refresh</Text>
          )}
        </Pressable>
      </View>

      <View style={s.stateCard}>
        {verifiedProps.map(({ name, label }) => {
          const raw = camera.liveProps[name];
          const shown = raw === undefined ? '—' : (PROP_LABELS[name]?.(raw) ?? raw);
          return (
            <View key={name} style={s.stateRow}>
              <Text style={s.stateLabel}>{label}</Text>
              <Text style={[s.stateValue, raw === undefined && s.stateMissing]}>{shown}</Text>
            </View>
          );
        })}
      </View>
      <Text style={s.note}>
        Read one property per call — this firmware omits unknown names from a batched reply instead
        of padding it, so batching silently mis-assigns values.
      </Text>

      <Text style={[s.groupLabel, s.spaced]}>CONFIRMED COMMANDS</Text>
      <View style={s.chips}>
        {verifiedCommands.map(c => (
          <Pressable key={signatureOf(c)} style={s.chip} onPress={() => fire(c)}>
            <Text style={s.chipText}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.note}>
        Both return "ok". Cruise was observed not to move the motors, so the acknowledgement means
        the write was parsed, not that anything acted on it.
      </Text>

      {discovered.length > 0 && (
        <>
          <Text style={[s.groupLabel, s.spaced]}>FOUND BY PROBE</Text>
          <View style={s.chips}>
            {discovered.map(c => (
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
        </>
      )}

      <View style={s.limits}>
        <Text style={s.limitsTitle}>What this camera won't do locally</Text>
        <Text style={s.limitsBody}>
          No pan or tilt. The motors are driven over Xiaomi's P2P channel, the same one carrying
          the video, so Mi Home can move the camera and a local client cannot. Every movement
          method — motor_move, set_motor, ptz_move, presets — was tried and returned nothing.
          {'\n\n'}
          No live video, for the same reason: the stream is P2P, not RTSP.
          {'\n\n'}
          Custom firmware is the only route to either, and its install writes the camera's internal
          flash with no documented way back.
        </Text>
      </View>
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

  stateHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupLabel: { color: theme.dim, fontSize: 11, letterSpacing: 1.2, marginBottom: 10 },
  spaced: { marginTop: 26 },
  stateCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  stateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  stateLabel: { color: theme.text, fontSize: 15 },
  stateValue: { color: theme.accent, fontSize: 15, fontWeight: '600' },
  stateMissing: { color: theme.faint, fontWeight: '400' },
  note: { color: theme.faint, fontSize: 11, lineHeight: 17, marginTop: 10 },

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

  limits: {
    marginTop: 32,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  limitsTitle: { color: theme.text, fontSize: 14, fontWeight: '600', marginBottom: 10 },
  limitsBody: { color: theme.dim, fontSize: 12, lineHeight: 19 },
});
