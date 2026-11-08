import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:pointycastle/export.dart';

/// miIO wire format — 32-byte header followed by an AES-128-CBC payload.
///
///   0   2  magic 0x2131
///   2   2  total length (header + payload), big endian
///   4   4  unknown (zero; 0xFFFFFFFF in hello)
///   8   4  device id
///   12  4  device stamp (seconds)
///   16 16  md5 checksum; holds the token while being computed
///
/// checksum = md5(header[0..16] + token + payload)
/// key = md5(token), iv = md5(key + token), PKCS#7 padding.
class MiioCodec {
  static const int magic = 0x2131;
  static const int headerLength = 32;
  static const int port = 54321;

  static final Uint8List hello = Uint8List.fromList([
    0x21, 0x31, 0x00, 0x20,
    ...List<int>.filled(28, 0xFF),
  ]);

  final Uint8List token;
  late final Uint8List _key;
  late final Uint8List _iv;

  MiioCodec(this.token) {
    if (token.length != 16) {
      throw ArgumentError('token must be 16 bytes (32 hex characters)');
    }
    _key = Uint8List.fromList(md5.convert(token).bytes);
    _iv = Uint8List.fromList(md5.convert([..._key, ...token]).bytes);
  }

  static Uint8List parseHexToken(String hex) {
    final clean = hex.replaceAll(RegExp(r'[^0-9a-fA-F]'), '');
    if (clean.length != 32) {
      throw ArgumentError('token must be 32 hex characters, got ${clean.length}');
    }
    return Uint8List.fromList([
      for (var i = 0; i < 32; i += 2) int.parse(clean.substring(i, i + 2), radix: 16),
    ]);
  }

  // --- AES ----------------------------------------------------------------
  Uint8List _runAes(Uint8List data, bool forEncryption) {
    final cipher = CBCBlockCipher(AESEngine())
      ..init(forEncryption, ParametersWithIV(KeyParameter(_key), _iv));
    final out = Uint8List(data.length);
    for (var offset = 0; offset < data.length;) {
      offset += cipher.processBlock(data, offset, out, offset);
    }
    return out;
  }

  Uint8List encrypt(Uint8List plain) {
    final pad = 16 - (plain.length % 16);
    return _runAes(
      Uint8List.fromList([...plain, ...List<int>.filled(pad, pad)]),
      true,
    );
  }

  Uint8List decrypt(Uint8List blob) {
    final out = _runAes(blob, false);
    if (out.isEmpty) return out;
    final pad = out.last;
    return (pad >= 1 && pad <= 16 && pad <= out.length)
        ? Uint8List.sublistView(out, 0, out.length - pad)
        : out;
  }

  // --- packets ------------------------------------------------------------
  Uint8List build(int deviceId, int stamp, Map<String, dynamic>? payload) {
    final body = payload == null
        ? Uint8List(0)
        : encrypt(Uint8List.fromList(utf8.encode(jsonEncode(payload))));

    final head = Uint8List(16);
    final view = ByteData.view(head.buffer);
    view.setUint16(0, magic);
    view.setUint16(2, headerLength + body.length);
    view.setUint32(4, 0);
    view.setUint32(8, deviceId);
    view.setUint32(12, stamp);

    final checksum = md5.convert([...head, ...token, ...body]).bytes;
    return Uint8List.fromList([...head, ...checksum, ...body]);
  }

  static MiioHeader parseHeader(Uint8List buf) {
    if (buf.length < headerLength) {
      throw FormatException('short packet: ${buf.length} bytes');
    }
    final view = ByteData.view(buf.buffer, buf.offsetInBytes);
    if (view.getUint16(0) != magic) {
      throw FormatException('bad magic 0x${view.getUint16(0).toRadixString(16)}');
    }
    return MiioHeader(
      length: view.getUint16(2),
      deviceId: view.getUint32(8),
      stamp: view.getUint32(12),
      checksum: Uint8List.fromList(buf.sublist(16, 32)),
    );
  }

  /// Returns null for a bodiless packet (a hello reply).
  Map<String, dynamic>? read(Uint8List buf) {
    final header = parseHeader(buf);
    if (buf.length <= headerLength) return null;
    final body = Uint8List.fromList(buf.sublist(headerLength));
    final expect = md5.convert([...buf.sublist(0, 16), ...token, ...body]).bytes;
    for (var i = 0; i < 16; i++) {
      if (expect[i] != header.checksum[i]) {
        throw const FormatException('checksum mismatch — wrong token?');
      }
    }
    var text = utf8.decode(decrypt(body), allowMalformed: true);
    text = text.replaceAll('\u0000', '').trim();
    return jsonDecode(text) as Map<String, dynamic>;
  }
}

class MiioHeader {
  final int length;
  final int deviceId;
  final int stamp;
  final Uint8List checksum;

  const MiioHeader({
    required this.length,
    required this.deviceId,
    required this.stamp,
    required this.checksum,
  });

  /// Most firmware blanks this field; older builds leak the token here.
  String? get disclosedToken {
    final allFF = checksum.every((b) => b == 0xFF);
    final allZero = checksum.every((b) => b == 0x00);
    if (allFF || allZero) return null;
    return checksum.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }
}
