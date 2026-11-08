import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCamera } from '../cameraStore';
import { candidateCommands, signatureOf } from '../commands';
import { statusColor, theme } from '../theme';

export const ProbeScreen: React.FC = () => {
  const camera = useCamera();
  const tested = candidateCommands.filter(c => camera.findings[signatureOf(c)]);
  const progress = camera.probeTotal === 0 ? 0 : camera.probeDone / camera.probeTotal;

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Text style={s.title}>Capability probe</Text>
      <Text style={s.body}>
        The sweep calls each candidate once and reads the camera's reply. "unsupported_method" means
        the name is wrong; "invalid params" is the useful answer — it proves the method exists and
        only the arguments were off.
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
        <Pressable style={s.button} onPress={() => camera.runProbe()}>
          <Text style={s.buttonText}>Run the sweep</Text>
        </Pressable>
      )}

      <Text style={s.help}>
        Takes about a minute. Destructive methods such as sdcard_format are listed but never fired.
      </Text>

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
          <Text style={s.sectionLabel}>RESULTS</Text>
          {tested.map(c => {
            const sig = signatureOf(c);
            const status = camera.findings[sig];
            const color = statusColor[status] ?? theme.faint;
            return (
              <View key={sig} style={s.row}>
                <View style={[s.statusDot, { backgroundColor: color }]} />
                <Text
                  style={[s.signature, status === 'absent' && s.signatureDim]}
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

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: theme.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  body: { color: theme.dim, fontSize: 13, lineHeight: 20, marginBottom: 20 },
  button: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
  buttonText: { color: '#00201E', fontSize: 16, fontWeight: '700' },
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
