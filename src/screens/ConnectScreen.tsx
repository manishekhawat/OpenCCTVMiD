import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useCamera } from '../cameraStore';
import { type Discovered, discover } from '../miio/device';
import { theme } from '../theme';

export const ConnectScreen: React.FC = () => {
  const camera = useCamera();
  const [ip, setIp] = useState(camera.ip);
  const [token, setToken] = useState(camera.token);
  const [found, setFound] = useState<Discovered[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const valid = token.replace(/[^0-9a-fA-F]/g, '').length === 32;

  const scan = async () => {
    setScanning(true);
    setFound(null);
    try {
      setFound(await discover());
    } finally {
      setScanning(false);
    }
  };

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Text style={s.title}>Dafang Control</Text>
      <Text style={s.subtitle}>Local miIO on UDP 54321 — no cloud, no Mi Home.</Text>

      <Text style={s.label}>Camera IP</Text>
      <TextInput
        style={s.input}
        value={ip}
        onChangeText={setIp}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="192.168.1.11"
        placeholderTextColor={theme.faint}
      />
      <Text style={s.help}>Mi Home ▸ ⋯ ▸ Network info</Text>

      <Text style={s.label}>Device token</Text>
      <TextInput
        style={[s.input, s.monoInput, valid && s.inputValid]}
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
        placeholder="32 hex characters"
        placeholderTextColor={theme.faint}
      />
      <Text style={s.help}>
        {valid ? '✓ 32 hex characters' : `${token.replace(/[^0-9a-fA-F]/g, '').length} of 32`}
      </Text>

      <Pressable
        style={[s.button, (!valid || camera.connecting) && s.buttonOff]}
        disabled={!valid || camera.connecting}
        onPress={() => camera.connect(ip, token)}>
        {camera.connecting ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={s.buttonText}>Connect</Text>
        )}
      </Pressable>

      {camera.connectionError && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{camera.connectionError}</Text>
        </View>
      )}

      <Pressable style={s.outlineButton} disabled={scanning} onPress={scan}>
        <Text style={s.outlineText}>{scanning ? 'Scanning…' : 'Scan the network'}</Text>
      </Pressable>

      {found !== null &&
        (found.length === 0 ? (
          <Text style={s.help}>
            Nothing answered. The camera may be asleep, on another subnet, or the router may be
            isolating Wi-Fi clients.
          </Text>
        ) : (
          found.map(d => (
            <Pressable
              key={d.ip}
              style={s.card}
              onPress={() => {
                setIp(d.ip);
                if (d.token) setToken(d.token);
              }}>
              <Text style={s.cardTitle}>{d.ip}</Text>
              <Text style={s.help}>
                id {d.deviceId} · {d.token ? 'token leaked by firmware' : 'token not disclosed'}
              </Text>
            </Pressable>
          ))
        ))}

      <View style={s.divider} />
      <Text style={s.sectionTitle}>Getting the token</Text>
      <Text style={s.body}>
        The token is the camera's local password — 16 bytes, never sent over the wire, used to
        derive the AES key. Mi Home holds it.{'\n\n'}
        1. Easiest: run Xiaomi-cloud-tokens-extractor on a PC and sign in with your Mi account.
        {'\n'}
        2. Or pull /data/data/com.xiaomi.smarthome/databases/miio2.db from a rooted device or an
        emulator.{'\n\n'}
        Resetting the camera or re-adding it in Mi Home changes the token.
      </Text>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 48 },
  title: { color: theme.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: theme.dim, fontSize: 14, marginTop: 6, marginBottom: 28 },
  label: { color: theme.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 8 },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 16,
  },
  monoInput: { fontFamily: theme.mono, fontSize: 14 },
  inputValid: { borderColor: theme.accent },
  help: { color: theme.faint, fontSize: 12, marginTop: 6, marginBottom: 20 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonOff: { opacity: 0.35 },
  buttonText: { color: '#00201E', fontSize: 16, fontWeight: '700' },
  outlineButton: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  outlineText: { color: theme.text, fontSize: 15 },
  errorBox: {
    backgroundColor: '#3A1618',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
  },
  errorText: { color: '#FFC9CC', fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: '600' },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 28 },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: '600', marginBottom: 10 },
  body: { color: theme.dim, fontSize: 13, lineHeight: 20 },
});
