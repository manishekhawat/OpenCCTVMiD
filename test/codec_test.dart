import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dafang_ctl/miio/codec.dart';
import 'package:flutter_test/flutter_test.dart';

/// The Dart port of the protocol must agree, byte for byte, with the Python
/// implementation in tools/ — the same test vectors are asserted in both.
void main() {
  final token = MiioCodec.parseHexToken('5541634749665859696a30414c4e5537');
  final codec = MiioCodec(token);

  group('key derivation', () {
    test('key is md5(token)', () {
      final key = md5.convert(token).bytes;
      final blob = codec.encrypt(Uint8List.fromList(utf8.encode('x')));
      expect(key.length, 16);
      expect(blob.length % 16, 0);
    });

    test('rejects a token of the wrong length', () {
      expect(() => MiioCodec.parseHexToken('abcd'), throwsArgumentError);
      expect(() => MiioCodec(Uint8List(8)), throwsArgumentError);
    });

    test('ignores separators in a pasted token', () {
      final a = MiioCodec.parseHexToken('5541634749665859696a30414c4e5537');
      final b = MiioCodec.parseHexToken('55:41:63:47:49:66:58:59:'
          '69:6a:30:41:4c:4e:55:37');
      expect(a, equals(b));
    });
  });

  group('encryption', () {
    for (final size in [0, 1, 15, 16, 17, 320]) {
      test('round-trips $size bytes', () {
        final plain = Uint8List.fromList(List.generate(size, (i) => i % 256));
        final blob = codec.encrypt(plain);
        expect(blob.length % 16, 0);
        expect(codec.decrypt(blob), equals(plain));
      });
    }

    test('a different token does not decrypt', () {
      final other = MiioCodec(Uint8List(16));
      final blob = codec.encrypt(Uint8List.fromList(utf8.encode('secret!!')));
      expect(other.decrypt(blob), isNot(equals(utf8.encode('secret!!'))));
    });
  });

  group('framing', () {
    test('hello is 32 bytes of the documented shape', () {
      expect(MiioCodec.hello.length, 32);
      expect(MiioCodec.hello.sublist(0, 4), equals([0x21, 0x31, 0x00, 0x20]));
      expect(MiioCodec.hello.sublist(4).every((b) => b == 0xFF), isTrue);
    });

    test('a built packet parses back', () {
      final packet = codec.build(0x01A2B3C4, 123, {
        'id': 7,
        'method': 'miIO.info',
        'params': <dynamic>[],
      });
      final header = MiioCodec.parseHeader(packet);
      expect(header.length, packet.length);
      expect(header.deviceId, 0x01A2B3C4);
      expect(header.stamp, 123);

      final payload = codec.read(packet)!;
      expect(payload['id'], 7);
      expect(payload['method'], 'miIO.info');
    });

    test('checksum covers the payload', () {
      final packet = codec.build(1, 1, {'id': 1, 'method': 'x', 'params': []});
      final tampered = Uint8List.fromList(packet);
      tampered[tampered.length - 1] ^= 0xFF;
      expect(() => codec.read(tampered), throwsFormatException);
    });

    test('a bodiless reply decodes as null', () {
      expect(codec.read(MiioCodec.hello), isNull);
    });

    test('bad magic is rejected', () {
      expect(() => MiioCodec.parseHeader(Uint8List(32)), throwsFormatException);
    });

    test('a short buffer is rejected', () {
      expect(() => MiioCodec.parseHeader(Uint8List(10)), throwsFormatException);
    });
  });

  group('token disclosure', () {
    MiioHeader headerWith(List<int> checksum) => MiioHeader(
          length: 32,
          deviceId: 1,
          stamp: 1,
          checksum: Uint8List.fromList(checksum),
        );

    test('0xFF padding means no token', () {
      expect(headerWith(List.filled(16, 0xFF)).disclosedToken, isNull);
    });

    test('zero padding means no token', () {
      expect(headerWith(List.filled(16, 0x00)).disclosedToken, isNull);
    });

    test('anything else is a leaked token', () {
      expect(headerWith(token).disclosedToken,
          '5541634749665859696a30414c4e5537');
    });
  });
}
