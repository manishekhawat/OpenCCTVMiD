# Dafang Control

A local-network control app for the **Xiaomi Dafang 1080p PTZ camera**
(`isa.camera.df3`), talking the miIO protocol directly over UDP 54321. No cloud,
no Mi Home, no vendor servers.

Built against: firmware `5.5.1_1025`, camera at `192.168.1.11`.

---

## Read this before you build it

Your camera runs **stock firmware**, and that decides what is and isn't
possible. Being straight about it:

| | Stock firmware (yours) | Dafang-Hacks custom firmware |
|---|---|---|
| Live video | P2P only — **not** reachable | RTSP + MJPEG + snapshot URL |
| PTZ motors | unknown, must be probed | direct, documented |
| Toggles (night mode, LED, motion) | partly, via miIO | all of them |
| Install risk | none | needs an SD-card flash |

**Live video is the honest gap.** On stock firmware the stream runs over
Xiaomi's proprietary TUTK P2P channel, not RTSP. `videoP2Proxy` exists and
converts P2P to RTSP, but its author only claims support for the Aqara gateway
camera (`lumi.camera.aq1`), and people who tried it against `isa.camera.df3`
reported it not working. So this app does control, not video. Keep Mi Home for
the picture.

**PTZ is an open question, and the app is built around that.** Xiaomi never
published the method list for this model; `python-miio` has no driver for it
and the request to add one was never resolved. Rather than ship buttons that
pretend to work, the app ships a **probe**: it calls each candidate method once
and reads what the camera says back.

That reply is informative:

- `unsupported_method` / `-32601` — the name is wrong, move on
- `invalid params` / `-32602` — **the method is real**, only the arguments were off
- a result — it works

The Control tab then shows only what your camera actually confirmed.

If the probe comes back with nothing for PTZ, that's a real answer too: this
firmware keeps motor control on the P2P channel, and custom firmware is the
only route. See *Custom firmware* below.

---

## Getting the token

The token is the camera's local password: 16 bytes, never transmitted, used to
derive the AES key (`key = md5(token)`, `iv = md5(key + token)`). Mi Home holds
it.

1. **Easiest** — run
   [Xiaomi-cloud-tokens-extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor)
   on a PC and sign in with your Mi account.
2. **Offline** — pull
   `/data/data/com.xiaomi.smarthome/databases/miio2.db` from a rooted phone or
   an Android emulator running Mi Home.
3. **Sometimes free** — the app's *Scan the network* button broadcasts a hello
   packet; some firmware builds leak the token in the reply. Yours probably
   won't, but it costs nothing to check.

Resetting the camera or re-adding it in Mi Home **changes the token**.

A token is full control of the device. Treat it like a password.

---

## Build it

```bash
flutter pub get
flutter test                       # 20 protocol tests, no device needed
flutter run                        # phone on the SAME Wi-Fi as the camera
flutter build apk --release        # -> build/app/outputs/flutter-apk/
```

`android/app/src/main/AndroidManifest.xml` needs:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
```

If you have no Flutter toolchain to hand, use the Python tools below first —
they answer the PTZ question in about a minute and need nothing but Python.

---

## The Python tools

Same protocol, runs on any PC on your LAN. Faster to iterate with than a phone
build, and the probe results are the same.

```bash
cd tools
pip install cryptography

python3 verify.py                                    # 39 self-tests, no camera
python3 probe.py --discover
python3 probe.py --ip 192.168.1.11 --token <32 hex> --out findings.json
python3 probe.py --ip 192.168.1.11 --token <32 hex> --call set_video '["on"]'
```

`verify.py` stands up a fake camera on localhost and checks the packet layout,
the checksum, the AES round-trip, the stale-reply filter and the wrong-token
path. Run it before you suspect the network.

Send me `findings.json` and I'll wire the confirmed methods into the Control tab
as real labelled buttons instead of probe chips.

---

## How the protocol works

```
 offset  size  field
 0       2     magic 0x2131
 2       2     total length (header + payload), big endian
 4       4     unknown (zero; 0xFFFFFFFF in hello)
 8       4     device id
 12      4     device stamp, seconds
 16      16    md5 checksum — holds the token while being computed

 checksum = md5(header[0..16] + token + encrypted_payload)
 key      = md5(token)
 iv       = md5(key + token)
 cipher   = AES-128-CBC, PKCS#7
 payload  = {"id": n, "method": "...", "params": [...]}
```

Two details that cause most of the trouble:

- **The stamp must track the camera's clock.** The device rejects packets whose
  stamp has drifted. Both implementations capture the stamp at handshake and
  advance it locally; on a timeout they re-handshake rather than retrying blind.
- **Replies are matched by request id.** A UDP answer to a request that already
  timed out will arrive late and land on the next one. Both implementations drop
  any reply whose `id` doesn't match.

---

## Custom firmware, if the probe comes up empty

[Xiaomi-Dafang-Hacks](https://github.com/EliasKotlyar/Xiaomi-Dafang-Hacks) turns
the camera into a plain HTTP/RTSP device: `rtsp://dafang:8554/unicast`, a
snapshot at `/cgi-bin/currentpic.cgi`, motor control at
`/cgi-bin/action.cgi?cmd=motor_up`, MQTT, SSH. An app against that is trivial by
comparison.

The catch: installation is an SD-card flash triggered at boot, and users on
`5.5.1.x` builds repeatedly reported the camera booting normally and ignoring
the card. Yours is `5.5.1_1025`, newer than any of those reports. **Assume it
won't take**, and treat it as an experiment rather than a plan.

If you try it: the method is reversible in principle (the hack lives on the SD
card, not in flash), it does not need the camera opened, and a failed attempt
usually just boots stock. A failed *firmware downgrade* is the part that bricks
cameras — don't do that one.

---

## Layout

```
lib/
  miio/codec.dart        packet framing, md5 key derivation, AES-128-CBC
  miio/device.dart       one shared UDP socket, handshake, stamp, id matching
  commands.dart          the candidate surface, and how confident we are
  camera_model.dart      connection, probe sweep, persisted findings
  ui/connect_page.dart   IP + token, network scan, token instructions
  ui/control_page.dart   PTZ pad and confirmed-command chips
  ui/probe_page.dart     the sweep and its results
  ui/console_page.dart   raw method + JSON params, with a reply log
test/codec_test.dart     protocol tests mirroring tools/verify.py
tools/miio.py            the same protocol in Python
tools/probe.py           CLI sweep
tools/verify.py          fake camera + 39 self-tests
```
