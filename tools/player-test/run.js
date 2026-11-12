#!/usr/bin/env node
/**
 * End-to-end check of the live-view player page, without a phone or camera.
 *
 * Encodes a test H.264 stream with ffmpeg, splits it into access units the
 * way the camera delivers frames, joins mid-GOP, and feeds it to the app's
 * own playerHtml() in headless Chromium through the same message path
 * react-native-webview uses. Passes if the page reports "playing" with no
 * errors; writes frame.png.
 *
 * Needs: ffmpeg, Playwright's Chromium.
 * Run from the repo root:  node tools/player-test/run.js
 */
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const ts = require('typescript');

const work = require('fs').mkdtempSync(path.join(os.tmpdir(), 'player-test-'));
for (const f of ['src/live/playerHtml.ts', 'src/live/jmuxerSource.ts']) {
  const out = ts.transpileModule(require('fs').readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  require('fs').writeFileSync(path.join(work, path.basename(f).replace('.ts', '.js')), out);
}
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=15', '-t', '6',
  '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '0',
  '-x264-params', 'aud=1', '-f', 'h264', path.join(work, 'stream.h264')]);
process.chdir(work);
// Feeds a real H.264 stream to the app's player page, the way the app does:
// split into access units, skip to the first keyframe, base64, posted to
// `document` as "H264|<ms>|<b64>", ~15 fps in real time.
const { chromium } = require('playwright');
const fs = require('fs');
const { playerHtml } = require(path.join(work, 'playerHtml.js'));

const data = fs.readFileSync('stream.h264');
// Split on AUD (00 00 00 01 09): one access unit per frame.
const aus = [];
let start = -1;
for (let i = 0; i + 4 < data.length; i++) {
  if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1 && (data[i + 4] & 0x1f) === 9) {
    if (start >= 0) aus.push(data.subarray(start, i));
    start = i;
  }
}
aus.push(data.subarray(start));
const isKey = au => { for (let i = 0; i + 4 < au.length; i++) if (au[i]===0&&au[i+1]===0&&au[i+2]===1&&(au[i+3]&0x1f)===5) return true; return false; };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  // The stand-in for react-native-webview's bridge, placed before the page's scripts.
  const stub = '<script>window.__msgs=[];window.ReactNativeWebView={postMessage:function(s){window.__msgs.push(JSON.parse(s))}};</script>';
  await p.setContent(playerHtml().replace('<head>', '<head>' + stub), { waitUntil: 'load' });

  // Start mid-GOP like the camera: drop the first 7 frames, then skip to a keyframe.
  let k = 7; while (!isKey(aus[k])) k++;
  const startTs = Date.now();
  for (let i = k; i < aus.length; i++) {
    const msg = `H264|66|${Buffer.from(aus[i]).toString('base64')}`;
    await p.evaluate(m => document.dispatchEvent(new MessageEvent('message', { data: m })), msg);
    await new Promise(r => setTimeout(r, 66));
  }
  await new Promise(r => setTimeout(r, 1500));
  const v = await p.evaluate(() => { const v = document.getElementById('v'); return { t: v.currentTime, w: v.videoWidth, h: v.videoHeight, paused: v.paused, ready: v.readyState }; });
  const msgs = await p.evaluate(() => window.__msgs);
  const kinds = [...new Set(msgs.map(m => m.t))];
  console.log(JSON.stringify({ frames: aus.length, fedFrom: k, video: v, messageKinds: kinds, errors: msgs.filter(m => m.t === 'error' || m.t === 'unsupported'), playing: msgs.find(m => m.t === 'playing'), seconds: (Date.now() - startTs) / 1000 }));
  await p.screenshot({ path: path.join(work, 'frame.png') });
  console.log('screenshot:', path.join(work, 'frame.png'));
  const failed = !msgs.some(m => m.t === 'playing') || msgs.some(m => m.t === 'error' || m.t === 'unsupported');
  process.exitCode = failed ? 1 : 0;
  await b.close();
})();
