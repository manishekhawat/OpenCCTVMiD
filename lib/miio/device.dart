import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'codec.dart';

class MiioException implements Exception {
  final Object detail;
  const MiioException(this.detail);

  bool get methodAbsent {
    final t = detail.toString().toLowerCase();
    return t.contains('unsupported') ||
        t.contains('-32601') ||
        t.contains('unknown method');
  }

  /// The device rejected our arguments — which proves the method is real.
  bool get methodExists {
    final t = detail.toString().toLowerCase();
    return !methodAbsent && (t.contains('-32602') || t.contains('invalid'));
  }

  @override
  String toString() => 'MiioException: $detail';
}

class MiioResult {
  final String method;
  final List<dynamic> params;
  final dynamic value;
  final Object? error;
  final Duration elapsed;
  final DateTime at;

  MiioResult({
    required this.method,
    required this.params,
    this.value,
    this.error,
    required this.elapsed,
  }) : at = DateTime.now();

  bool get ok => error == null;
}

/// One UDP socket, bound once, shared by every request.
class MiioDevice {
  final String ip;
  final int port;
  final MiioCodec codec;
  final Duration timeout;

  RawDatagramSocket? _socket;
  final _inbox = StreamController<Uint8List>.broadcast();

  int deviceId = 0;
  int _stamp = 0;
  DateTime? _stampAt;
  int _requestId = 0;

  MiioDevice({
    required this.ip,
    required String token,
    this.port = MiioCodec.port,
    this.timeout = const Duration(seconds: 3),
  }) : codec = MiioCodec(MiioCodec.parseHexToken(token));

  bool get connected => _stampAt != null;

  /// Device clock, advanced locally so packets stay inside its replay window.
  int get stamp => _stampAt == null
      ? 0
      : _stamp + DateTime.now().difference(_stampAt!).inSeconds;

  Future<void> _ensureSocket() async {
    if (_socket != null) return;
    final s = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
    s.broadcastEnabled = true;
    s.listen((event) {
      if (event != RawSocketEvent.read) return;
      final dg = s.receive();
      if (dg != null) _inbox.add(dg.data);
    });
    _socket = s;
  }

  Future<MiioHeader> handshake() async {
    await _ensureSocket();
    final reply = _inbox.stream.first.timeout(timeout);
    _socket!.send(MiioCodec.hello, InternetAddress(ip), port);
    final header = MiioCodec.parseHeader(await reply);
    deviceId = header.deviceId;
    _stamp = header.stamp;
    _stampAt = DateTime.now();
    return header;
  }

  Future<MiioResult> send(
    String method, [
    List<dynamic> params = const [],
    int retries = 1,
  ]) async {
    final started = DateTime.now();
    Object? lastError;

    for (var attempt = 0; attempt <= retries; attempt++) {
      try {
        if (!connected) await handshake();
        _requestId = (_requestId % 9999) + 1;
        final id = _requestId;
        final packet = codec.build(deviceId, stamp, {
          'id': id,
          'method': method,
          'params': params,
        });

        final completer = Completer<Map<String, dynamic>>();
        late StreamSubscription sub;
        sub = _inbox.stream.listen((data) {
          try {
            final decoded = codec.read(data);
            // Ignore hello replies and answers to earlier, timed-out requests.
            if (decoded == null || decoded['id'] != id) return;
            if (!completer.isCompleted) completer.complete(decoded);
          } catch (_) {
            // Malformed or foreign packet — keep waiting.
          }
        });

        try {
          _socket!.send(packet, InternetAddress(ip), port);
          final response = await completer.future.timeout(timeout);
          if (response.containsKey('error')) {
            throw MiioException(response['error'] as Object);
          }
          return MiioResult(
            method: method,
            params: params,
            value: response['result'],
            elapsed: DateTime.now().difference(started),
          );
        } finally {
          await sub.cancel();
        }
      } on MiioException {
        rethrow; // A real answer from the camera; retrying changes nothing.
      } catch (e) {
        lastError = e;
        _stampAt = null; // Force a fresh handshake; the stamp may have drifted.
      }
    }

    return MiioResult(
      method: method,
      params: params,
      error: lastError ?? 'no response from $ip',
      elapsed: DateTime.now().difference(started),
    );
  }

  Future<MiioResult> info() => send('miIO.info');

  Future<MiioResult> getProp(List<String> props) => send('get_prop', props);

  void dispose() {
    _socket?.close();
    _socket = null;
    _stampAt = null;
    _inbox.close();
  }
}

class Discovered {
  final String ip;
  final int deviceId;
  final String? token;
  const Discovered(this.ip, this.deviceId, this.token);
}

/// Broadcast a hello and collect whatever answers on the LAN.
Future<List<Discovered>> discover({
  Duration window = const Duration(seconds: 4),
}) async {
  final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
  socket.broadcastEnabled = true;
  final found = <String, Discovered>{};

  socket.listen((event) {
    if (event != RawSocketEvent.read) return;
    final dg = socket.receive();
    if (dg == null) return;
    try {
      final header = MiioCodec.parseHeader(dg.data);
      found[dg.address.address] = Discovered(
        dg.address.address,
        header.deviceId,
        header.disclosedToken,
      );
    } catch (_) {
      // Not a miIO device.
    }
  });

  for (final target in ['255.255.255.255', '192.168.1.255', '192.168.0.255']) {
    try {
      socket.send(MiioCodec.hello, InternetAddress(target), MiioCodec.port);
    } catch (_) {
      // Subnet not routable from this interface.
    }
  }

  await Future<void>.delayed(window);
  socket.close();
  return found.values.toList();
}
