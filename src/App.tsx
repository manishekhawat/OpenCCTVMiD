import React, { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { CameraProvider, useCamera } from './cameraStore';
import { ConnectScreen } from './screens/ConnectScreen';
import { ConsoleScreen } from './screens/ConsoleScreen';
import { ControlScreen } from './screens/ControlScreen';
import { ProbeScreen } from './screens/ProbeScreen';
import { theme } from './theme';

const TABS = [
  { key: 'control', label: 'Control', glyph: '◉' },
  { key: 'probe', label: 'Probe', glyph: '⚗' },
  { key: 'console', label: 'Console', glyph: '⌘' },
] as const;

const Shell: React.FC = () => {
  const camera = useCamera();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('control');

  useEffect(() => {
    void camera.load();
    // Intentionally once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!camera.connected) {
    return <ConnectScreen />;
  }

  return (
    <View style={s.shell}>
      <View style={s.body}>
        {tab === 'control' && <ControlScreen />}
        {tab === 'probe' && <ProbeScreen />}
        {tab === 'console' && <ConsoleScreen />}
      </View>
      <View style={s.tabBar}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} style={s.tab} onPress={() => setTab(t.key)}>
              <Text style={[s.tabGlyph, active && s.tabActive]}>{t.glyph}</Text>
              <Text style={[s.tabLabel, active && s.tabActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaView style={s.root}>
      {/* RN 0.88 dropped StatusBar's backgroundColor for edge-to-edge; the
          root SafeAreaView paints theme.bg behind it instead. */}
      <StatusBar barStyle="light-content" />
      <CameraProvider>
        <Shell />
      </CameraProvider>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  shell: { flex: 1 },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.surface,
    paddingBottom: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabGlyph: { color: theme.faint, fontSize: 18 },
  tabLabel: { color: theme.faint, fontSize: 11, marginTop: 2 },
  tabActive: { color: theme.accent },
});
