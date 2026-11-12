import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { findWorkingCredentials } from '../cloud/match';
import { type CloudDevice, type LoginStep, XiaomiCloud, isCamera } from '../cloud/xiaomi';
import { theme } from '../theme';

/**
 * Sign in with the Mi account, pick the camera, and the app fills in the IP
 * and token itself — replacing the separate token-extractor step.
 *
 * Nothing from the account is stored: the password is used once, the session
 * lives in memory, and what persists is the device token, as before.
 */

type Phase =
  | { kind: 'form' }
  | { kind: 'busy'; note: string }
  | { kind: 'captcha'; image: string }
  | { kind: 'verify'; via: 'email' | 'phone'; target: string }
  | { kind: 'devices'; devices: CloudDevice[] };

export const CloudLogin: React.FC<{ onFound: (ip: string, token: string) => void }> = ({ onFound }) => {
  const cloud = useRef(new XiaomiCloud());
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');

  const run = async (note: string, work: () => Promise<LoginStep>) => {
    setError(null);
    setPhase({ kind: 'busy', note });
    try {
      const step = await work();
      setCode('');
      if (step.kind === 'captcha') setPhase({ kind: 'captcha', image: step.imageBase64 });
      else if (step.kind === 'verify') setPhase({ kind: 'verify', via: step.via, target: step.target });
      else await loadDevices();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase({ kind: 'form' });
    }
  };

  const loadDevices = async () => {
    setPhase({ kind: 'busy', note: 'Reading your devices…' });
    const all = await cloud.current.listDevices(server =>
      setPhase({ kind: 'busy', note: `Reading devices on server "${server}"…` }),
    );
    if (all.length === 0) {
      setError('Signed in, but the account lists no devices on any server.');
      setPhase({ kind: 'form' });
      return;
    }
    setPhase({ kind: 'devices', devices: all });
  };

  const choose = async (d: CloudDevice, all: CloudDevice[]) => {
    setError(null);
    setPhase({ kind: 'busy', note: `Checking ${d.name}…` });
    const creds = await findWorkingCredentials(d, all, (ip, tail) =>
      setPhase({ kind: 'busy', note: `Trying ${ip} with token …${tail}` }),
    );
    if (!creds) {
      setError(
        `${d.name} did not answer with any token the account lists. Make sure this phone is on the ` +
          `same Wi-Fi as the camera.`,
      );
      setPhase({ kind: 'devices', devices: all });
      return;
    }
    setOpen(false);
    onFound(creds.ip, creds.token);
  };

  if (!open) {
    return (
      <Pressable style={s.cta} onPress={() => setOpen(true)}>
        <Text style={s.ctaTitle}>Sign in with Mi account</Text>
        <Text style={s.ctaBody}>Finds the camera and its token for you. Nothing is stored but the token.</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>Mi account</Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={12}>
          <Text style={s.link}>Close</Text>
        </Pressable>
      </View>

      {error && <Text style={s.error}>{error}</Text>}

      {phase.kind === 'form' && (
        <>
          <TextInput
            style={s.input}
            value={user}
            onChangeText={setUser}
            placeholder="Email, phone or Xiaomi ID"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <TextInput
            style={s.input}
            value={pass}
            onChangeText={setPass}
            placeholder="Password"
            placeholderTextColor={theme.faint}
            secureTextEntry
          />
          <Pressable
            style={[s.button, (!user || !pass) && s.buttonOff]}
            disabled={!user || !pass}
            onPress={() => run('Signing in…', () => cloud.current.login(user, pass))}>
            <Text style={s.buttonText}>Sign in</Text>
          </Pressable>
          <Text style={s.help}>
            Talks to Xiaomi's servers directly, the same requests the token extractor made. The password
            is used once and not saved.
          </Text>
        </>
      )}

      {phase.kind === 'busy' && (
        <View style={s.busy}>
          <ActivityIndicator color={theme.accent} />
          <Text style={s.busyText}>{phase.note}</Text>
        </View>
      )}

      {phase.kind === 'captcha' && (
        <>
          <Text style={s.body}>Xiaomi wants a captcha. Type the characters in the picture.</Text>
          {phase.image ? (
            <Image style={s.captcha} resizeMode="contain" source={{ uri: `data:image/jpeg;base64,${phase.image}` }} />
          ) : (
            <Text style={s.help}>The captcha image did not load.</Text>
          )}
          <TextInput
            style={s.input}
            value={code}
            onChangeText={setCode}
            placeholder="Captcha"
            placeholderTextColor={theme.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[s.button, !code && s.buttonOff]}
            disabled={!code}
            onPress={() => run('Checking…', () => cloud.current.submitCaptcha(code))}>
            <Text style={s.buttonText}>Continue</Text>
          </Pressable>
        </>
      )}

      {phase.kind === 'verify' && (
        <>
          <Text style={s.body}>
            Xiaomi sent a verification code to your {phase.via}
            {phase.target ? ` (${phase.target})` : ''}. Enter it here.
          </Text>
          <TextInput
            style={[s.input, s.mono]}
            value={code}
            onChangeText={setCode}
            placeholder="Code"
            placeholderTextColor={theme.faint}
            keyboardType="number-pad"
          />
          <Pressable
            style={[s.button, !code && s.buttonOff]}
            disabled={!code}
            onPress={() => run('Verifying…', () => cloud.current.submitVerificationCode(code))}>
            <Text style={s.buttonText}>Verify</Text>
          </Pressable>
        </>
      )}

      {phase.kind === 'devices' && (
        <>
          <Text style={s.body}>Pick your camera. The app tests which token it answers to.</Text>
          {[...phase.devices]
            .sort((a, b) => Number(isCamera(b)) - Number(isCamera(a)))
            .map(d => {
              const cam = isCamera(d);
              return (
                <Pressable
                  key={`${d.server}:${d.did}:${d.token}`}
                  style={[s.device, !cam && s.deviceDim]}
                  disabled={!cam}
                  onPress={() => choose(d, phase.devices)}>
                  <Text style={s.deviceName}>{d.name || d.model}</Text>
                  <Text style={s.deviceMeta}>
                    {d.model} · {d.ip || 'no IP'} · server {d.server}
                  </Text>
                </Pressable>
              );
            })}
        </>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  cta: {
    backgroundColor: theme.accentDim,
    borderRadius: 12,
    padding: 16,
    marginBottom: 28,
  },
  ctaTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  ctaBody: { color: theme.dim, fontSize: 12, marginTop: 4, lineHeight: 18 },

  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 28,
    gap: 10,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  link: { color: theme.accent, fontSize: 13 },
  error: { color: '#FFC9CC', backgroundColor: '#3A1618', borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
  },
  mono: { fontFamily: theme.mono, letterSpacing: 2 },
  button: { backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonOff: { opacity: 0.35 },
  buttonText: { color: '#00201E', fontSize: 15, fontWeight: '700' },
  help: { color: theme.faint, fontSize: 11, lineHeight: 17 },
  body: { color: theme.dim, fontSize: 13, lineHeight: 19 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  busyText: { color: theme.dim, fontSize: 13, flex: 1 },
  captcha: { width: '100%', height: 70, backgroundColor: '#fff', borderRadius: 8 },
  device: { backgroundColor: theme.surfaceAlt, borderRadius: 10, padding: 12 },
  deviceDim: { opacity: 0.4 },
  deviceName: { color: theme.text, fontSize: 15, fontWeight: '600' },
  deviceMeta: { color: theme.dim, fontSize: 11, marginTop: 3 },
});
