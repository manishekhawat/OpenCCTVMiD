import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCamera } from '../cameraStore';
import { theme } from '../theme';

const pad = (n: number) => String(n).padStart(2, '0');

/** Raw miIO console — send any method with any params and read the reply. */
export const ConsoleScreen: React.FC = () => {
  const camera = useCamera();
  const [method, setMethod] = useState('miIO.info');
  const [params, setParams] = useState('[]');
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    let parsed: unknown[];
    try {
      const decoded = JSON.parse(params);
      parsed = Array.isArray(decoded) ? decoded : [decoded];
    } catch (e) {
      setError(`Params must be valid JSON: ${e}`);
      return;
    }
    setError(null);
    await camera.call(method.trim(), parsed);
  };

  return (
    <View style={s.page}>
      <View style={s.bar}>
        <TextInput
          style={[s.input, s.methodInput]}
          value={method}
          onChangeText={setMethod}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="method"
          placeholderTextColor={theme.faint}
        />
        <TextInput
          style={[s.input, s.paramsInput]}
          value={params}
          onChangeText={setParams}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="params"
          placeholderTextColor={theme.faint}
        />
        <Pressable style={s.send} onPress={send}>
          <Text style={s.sendText}>▶</Text>
        </Pressable>
      </View>
      {error && <Text style={s.error}>{error}</Text>}

      <FlatList
        data={camera.log}
        keyExtractor={(item, i) => `${item.at.getTime()}-${i}`}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.empty}>Nothing sent yet</Text>}
        renderItem={({ item }) => (
          <View style={s.entry}>
            <View style={s.entryHead}>
              <Text style={[s.mark, { color: item.ok ? theme.good : theme.bad }]}>
                {item.ok ? '✓' : '✗'}
              </Text>
              <Text style={s.entryMethod} numberOfLines={1}>
                {item.method}
              </Text>
              <Text style={s.time}>
                {pad(item.at.getHours())}:{pad(item.at.getMinutes())}:{pad(item.at.getSeconds())}
              </Text>
            </View>
            <Text style={s.detail}>{item.detail}</Text>
          </View>
        )}
      />
    </View>
  );
};

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', padding: 12, gap: 8, alignItems: 'center' },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: theme.text,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  methodInput: { flex: 3 },
  paramsInput: { flex: 2 },
  send: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendText: { color: '#00201E', fontSize: 14, fontWeight: '700' },
  error: { color: theme.bad, fontSize: 12, paddingHorizontal: 12, paddingBottom: 8 },
  list: { padding: 16 },
  empty: { color: theme.faint, textAlign: 'center', marginTop: 40 },
  entry: { marginBottom: 16 },
  entryHead: { flexDirection: 'row', alignItems: 'center' },
  mark: { fontSize: 12, marginRight: 8 },
  entryMethod: { flex: 1, color: theme.text, fontFamily: theme.mono, fontSize: 12, fontWeight: '600' },
  time: { color: theme.faint, fontSize: 11 },
  detail: { color: theme.dim, fontFamily: theme.mono, fontSize: 11, marginTop: 4, marginLeft: 20 },
});
