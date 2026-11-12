import { Buffer } from 'buffer';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

// react-native-webview's typings default the extra-props parameter to
// undefined, and WebViewProps & undefined is never under React 19's types.
// Naming it explicitly restores the real props.
type Web = WebView<object>;

import { playerHtml } from './playerHtml';
import { liveSession } from './session';
import { theme } from '../theme';

/**
 * The live picture: a WebView running jmuxer (see playerHtml.ts), fed the
 * decrypted frames from the live session.
 *
 * Frames before the first keyframe are dropped — a decoder can't start on an
 * in-between frame, and the first P2P run showed the stream joins mid-GOP.
 */
export const LivePlayer: React.FC = () => {
  const web = useRef<Web>(null);
  const loaded = useRef(false);
  const sawKeyframe = useRef(false);
  const last = useRef(0);
  const [phase, setPhase] = useState<'waiting' | 'playing' | 'error'>('waiting');
  const [note, setNote] = useState('Waiting for the first keyframe…');
  const [size, setSize] = useState('');
  const html = useMemo(playerHtml, []);

  useEffect(() => {
    liveSession.onFrame(f => {
      if (!loaded.current || !web.current) return;
      if (!sawKeyframe.current) {
        if (!f.keyframe) return;
        sawKeyframe.current = true;
      }
      const now = Date.now();
      const duration = last.current ? Math.min(500, Math.max(20, now - last.current)) : 66;
      last.current = now;
      const codec = f.codec === 5 ? 'H265' : 'H264';
      web.current.postMessage(`${codec}|${duration}|${Buffer.from(f.payload).toString('base64')}`);
    });
    return () => liveSession.onFrame(null);
  }, []);

  const onMessage = (raw: string) => {
    let m: { t: string; m?: string; w?: number; h?: number; codec?: string; fed?: number };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'loaded') loaded.current = true;
    else if (m.t === 'playing') {
      setPhase('playing');
      if (m.w) setSize(`${m.w}×${m.h}`);
    } else if (m.t === 'stats' && m.w) setSize(`${m.w}×${m.h}`);
    else if (m.t === 'unsupported') {
      setPhase('error');
      setNote(`This phone's browser can't decode ${m.codec}.`);
    } else if (m.t === 'error') {
      setPhase('error');
      setNote(`Player error: ${m.m}`);
    }
  };

  return (
    <View style={s.frame}>
      <WebView<object>
        ref={web}
        source={{ html, baseUrl: 'https://localhost/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        style={s.web}
        onMessage={(e: WebViewMessageEvent) => onMessage(e.nativeEvent.data)}
      />
      {phase !== 'playing' && (
        <View style={s.overlay} pointerEvents="none">
          {phase === 'waiting' && <ActivityIndicator color={theme.accent} />}
          <Text style={[s.note, phase === 'error' && s.error]}>{note}</Text>
        </View>
      )}
      {phase === 'playing' && !!size && (
        <Text style={s.badge} pointerEvents="none">
          LIVE · {size}
        </Text>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  frame: { aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 14, overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  note: { color: theme.dim, fontSize: 12, textAlign: 'center' },
  error: { color: '#FFC9CC' },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: 'rgba(220,40,40,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
