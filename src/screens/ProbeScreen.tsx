import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCamera } from '../cameraStore';
import { statusColor, theme } from '../theme';

export const ProbeScreen: React.FC = () => {
  const camera = useCamera();
  // Render from findings rather than from the candidate list: the MIoT grid
  // is generated at sweep time and isn't in candidateCommands, so filtering by
  // it would discover a hit and then hide it.
  const rank: Record<string, number> = { works: 0, exists: 1, empty: 2, ignored: 3, absent: 4, untested: 5 };
  const tested = Object.entries(camera.findings).sort(
    (a, b) => (rank[a[1]] ?? 9) - (rank[b[1]] ?? 9) || a[0].localeCompare(b[0]),
  );
  const answered = tested.filter(([, v]) => v === 'works' || v === 'exists').length;
  const progress = camera.probeTotal === 0 ? 0 : camera.probeDone / camera.probeTotal;

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Text style={s.title}>Capability probe</Text>
      <Text style={s.body}>
        This firmware answers nothing at all for methods it doesn't implement, where a conforming
        miIO device would say "unsupported_method". So "ignored" means the camera declined, not
        that the packet was lost — miIO.info answering in the same sweep is what rules out the
        network.{'\n\n'}
        "empty" is the trap: get_properties is accepted for any siid/piid and returns [] every
        time. A reply is not a result, so a call only counts as working when it carries a value.
      </Text>

      {camera.probing ? (
        <View style={s.progressBlock}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={s.help}>
            {camera.probeDone} of {camera.probeTotal}
          </Text>
        </View>
      ) : (
        <>
          <Pressable style={s.button} onPress={() => camera.runProbe()}>
            <Text style={s.buttonText}>Run the sweep</Text>
          </Pressable>
          <Text style={s.help}>
            Reads every candidate property one at a time, then every known method, then a MIoT
            siid/piid grid — the published spec for this model omits get_prop and set_cruise, both
            of which answer, so it can't be trusted to be complete.
          </Text>

          <Pressable style={s.dangerButton} onPress={() => confirmActions(camera.runProbe)}>
            <Text style={s.dangerText}>Also sweep MIoT actions</Text>
          </Pressable>
          <Text style={s.help}>
            Actions invoke rather than read. On a device whose spec is already known to be
            incomplete, there is no way to know what an unlisted action does before calling it — a
            factory reset would look like any other. Off by default for that reason.
          </Text>
        </>
      )}

      {Object.keys(camera.liveProps).length > 0 && (
        <>
          <Text style={s.sectionLabel}>PROPERTIES THAT ANSWERED</Text>
          {Object.entries(camera.liveProps).map(([k, v]) => (
            <View key={k} style={s.propRow}>
              <Text style={s.propName}>{k}</Text>
              <Text style={s.propValue}>{v}</Text>
            </View>
          ))}
        </>
      )}

      {tested.length > 0 && (
        <>
          <Text style={s.sectionLabel}>
            RESULTS — {answered} ANSWERED OF {tested.length}
          </Text>
          {tested.map(([sig, status]) => {
            const color = statusColor[status] ?? theme.faint;
            return (
              <View key={sig} style={s.row}>
                <View style={[s.statusDot, { backgroundColor: color }]} />
                <Text
                  style={[
                    s.signature,
                    (status === 'absent' || status === 'empty') && s.signatureDim,
                  ]}
                  numberOfLines={1}>
                  {sig}
                </Text>
                <Text style={[s.statusText, { color }]}>{status}</Text>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
};

const confirmActions = (run: (includeActions: boolean) => void) =>
  Alert.alert(
    'Sweep MIoT actions?',
    'This calls every action slot in the grid. Unlisted actions are undocumented, and one of ' +
      'them could reset or reconfigure the camera. Only do this if you accept that risk.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sweep anyway', style: 'destructive', onPress: () => run(true) },
    ],
  );

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: theme.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  body: { color: theme.dim, fontSize: 13, lineHeight: 20, marginBottom: 20 },
  button: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
  buttonText: { color: '#00201E', fontSize: 16, fontWeight: '700' },
  dangerButton: {
    marginTop: 20,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5A2A2E',
  },
  dangerText: { color: '#FFC9CC', fontSize: 14 },
  progressBlock: { marginVertical: 8 },
  track: { height: 4, backgroundColor: theme.surfaceAlt, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: theme.accent },
  help: { color: theme.faint, fontSize: 12, marginTop: 10, lineHeight: 18 },
  sectionLabel: { color: theme.dim, fontSize: 11, letterSpacing: 1.2, marginTop: 28, marginBottom: 10 },
  propRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  propName: { color: theme.text, fontFamily: theme.mono, fontSize: 12 },
  propValue: { color: theme.dim, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  signature: { flex: 1, color: theme.text, fontFamily: theme.mono, fontSize: 11 },
  signatureDim: { color: theme.faint },
  statusText: { fontSize: 10, marginLeft: 8 },
});
