import { JMUXER_SOURCE } from './jmuxerSource';

/**
 * The page inside the WebView that plays the camera.
 *
 * The camera sends raw H.264 over P2P. A phone can't play raw H.264 from
 * JavaScript, but a browser can play fragmented MP4 through Media Source
 * Extensions, and jmuxer converts one into the other. So: React Native
 * decrypts each frame and posts it here (base64), jmuxer muxes it, the
 * <video> element decodes it in hardware.
 *
 * jmuxer is inlined, not loaded from a CDN — the live view must work on a
 * LAN without internet.
 *
 * Message format, React Native -> page:  "<H264|H265>|<durationMs>|<base64>"
 * Page -> React Native: JSON {t: 'loaded'|'ready'|'playing'|'stats'|'error'|'unsupported', ...}
 */
export const playerHtml = (): string => `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: contain; background: #000; }
</style>
</head>
<body>
<video id="v" autoplay muted playsinline></video>
<script>${JMUXER_SOURCE}</script>
<script>
(function () {
  function post(o) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }
  var v = document.getElementById('v');
  var jm = null, fed = 0, playing = false;

  function make(codec) {
    jm = new JMuxer({
      node: v,
      mode: 'video',
      videoCodec: codec,
      flushingTime: 0,     // live: hand each frame to the decoder at once
      maxDelay: 300,
      clearBuffer: true,
      fps: 15,
      debug: false,
      onReady: function () { post({ t: 'ready' }); },
      onError: function (e) { post({ t: 'error', m: String((e && e.message) || e) }); },
      onUnsupportedCodec: function () { post({ t: 'unsupported', codec: codec }); }
    });
  }

  function decode64(s) {
    var bin = atob(s), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  function onMessage(e) {
    var d = e.data;
    if (typeof d !== 'string') return;
    var a = d.indexOf('|'), b = d.indexOf('|', a + 1);
    if (a < 0 || b < 0) return;
    if (!jm) make(d.slice(0, a));
    try {
      jm.feed({ video: decode64(d.slice(b + 1)), duration: +d.slice(a + 1, b) });
      fed++;
    } catch (err) {
      post({ t: 'error', m: String(err) });
    }
  }
  // Android delivers to document, iOS to window.
  document.addEventListener('message', onMessage);
  window.addEventListener('message', onMessage);

  v.addEventListener('playing', function () {
    if (!playing) { playing = true; post({ t: 'playing', w: v.videoWidth, h: v.videoHeight }); }
  });

  // Stay at the live edge: if decoding falls behind, skip forward rather than
  // let the delay grow. A security camera an hour behind is worse than a
  // dropped frame.
  setInterval(function () {
    try {
      if (v.buffered.length) {
        var end = v.buffered.end(v.buffered.length - 1);
        if (end - v.currentTime > 1.5) v.currentTime = end - 0.2;
      }
      if (v.paused && fed > 0) v.play().catch(function () {});
      post({ t: 'stats', fed: fed, w: v.videoWidth, h: v.videoHeight });
    } catch (e) {}
  }, 1000);

  post({ t: 'loaded' });
})();
</script>
</body>
</html>`;
