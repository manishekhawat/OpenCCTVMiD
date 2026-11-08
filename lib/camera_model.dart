import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'commands.dart';
import 'miio/device.dart';

enum MethodStatus { untested, works, exists, absent, silent }

class LogEntry {
  final String method;
  final String detail;
  final bool ok;
  final DateTime at = DateTime.now();

  LogEntry(this.method, this.detail, this.ok);
}

class CameraModel extends ChangeNotifier {
  static const _kIp = 'ip';
  static const _kToken = 'token';
  static const _kFindings = 'findings';

  String ip = '192.168.1.11';
  String token = '';
  MiioDevice? _device;

  String? connectionError;
  bool connecting = false;
  Map<String, dynamic>? deviceInfo;

  /// method signature -> status, persisted so probing is a one-time cost.
  final Map<String, MethodStatus> findings = {};
  final Map<String, String> liveProps = {};
  final List<LogEntry> log = [];

  bool probing = false;
  int probeDone = 0;
  int probeTotal = 0;

  bool get connected => _device?.connected ?? false;

  // --- persistence --------------------------------------------------------
  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    ip = prefs.getString(_kIp) ?? ip;
    token = prefs.getString(_kToken) ?? '';
    final raw = prefs.getString(_kFindings);
    if (raw != null) {
      (jsonDecode(raw) as Map<String, dynamic>).forEach((k, v) {
        findings[k] = MethodStatus.values.firstWhere(
          (s) => s.name == v,
          orElse: () => MethodStatus.untested,
        );
      });
    }
    notifyListeners();
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kIp, ip);
    await prefs.setString(_kToken, token);
    await prefs.setString(
      _kFindings,
      jsonEncode(findings.map((k, v) => MapEntry(k, v.name))),
    );
  }

  // --- connection ---------------------------------------------------------
  Future<bool> connect(String newIp, String newToken) async {
    connecting = true;
    connectionError = null;
    notifyListeners();

    _device?.dispose();
    try {
      final dev = MiioDevice(ip: newIp.trim(), token: newToken.trim());
      await dev.handshake();
      final info = await dev.info();
      _device = dev;
      ip = newIp.trim();
      token = newToken.trim();
      deviceInfo = info.ok ? info.value as Map<String, dynamic>? : null;
      if (!info.ok) {
        connectionError = 'Handshake worked but miIO.info failed — the token '
            'is probably wrong for this camera.';
      }
      await _save();
      _note('connect', info.ok ? 'device_id ${dev.deviceId}' : '${info.error}',
          info.ok);
      return info.ok;
    } catch (e) {
      connectionError = _explain(e);
      _note('connect', '$e', false);
      return false;
    } finally {
      connecting = false;
      notifyListeners();
    }
  }

  String _explain(Object e) {
    final text = e.toString();
    if (text.contains('checksum')) {
      return 'The camera replied but the token is wrong. Re-extract it — a '
          'token changes every time the camera is reset or re-added in Mi Home.';
    }
    if (text.contains('TimeoutException') || text.contains('no response')) {
      return 'No reply from $ip on UDP 54321. Check the phone is on the same '
          'Wi-Fi (not mobile data), the camera is awake, and AP isolation / '
          'client isolation is off on the router.';
    }
    return text;
  }

  void disconnect() {
    _device?.dispose();
    _device = null;
    deviceInfo = null;
    notifyListeners();
  }

  // --- calling ------------------------------------------------------------
  Future<MiioResult?> call(String method, List<dynamic> params) async {
    final dev = _device;
    if (dev == null) return null;

    final signature = '$method(${params.join(', ')})';
    MiioResult result;
    try {
      result = await dev.send(method, params);
      findings[signature] = MethodStatus.works;
      _note(signature, jsonEncode(result.value), true);
    } on MiioException catch (e) {
      findings[signature] =
          e.methodAbsent ? MethodStatus.absent : MethodStatus.exists;
      result = MiioResult(
          method: method, params: params, error: e.detail, elapsed: Duration.zero);
      _note(signature, '${e.detail}', false);
    }
    unawaited(_save());
    notifyListeners();
    return result;
  }

  /// Tries each candidate for a direction until one is accepted, then
  /// remembers the winner so later presses go straight to it.
  String? preferredPtz(String direction) {
    for (final c in ptzByDirection[direction] ?? const <Candidate>[]) {
      if (findings[c.signature] == MethodStatus.works) return c.signature;
    }
    return null;
  }

  Future<bool> nudge(String direction) async {
    for (final c in ptzByDirection[direction] ?? const <Candidate>[]) {
      if (findings[c.signature] == MethodStatus.absent) continue;
      final r = await call(c.method, c.params);
      if (r != null && r.ok) return true;
    }
    return false;
  }

  // --- probing ------------------------------------------------------------
  Future<void> runProbe({bool includeDestructive = false}) async {
    final dev = _device;
    if (dev == null || probing) return;

    final queue = candidateCommands
        .where((c) => includeDestructive || !c.destructive)
        .toList();

    probing = true;
    probeDone = 0;
    probeTotal = queue.length + candidateProps.length;
    notifyListeners();

    for (final name in candidateProps) {
      try {
        final r = await dev.getProp([name]);
        final v = r.ok ? (r.value as List?)?.firstOrNull : null;
        if (v != null && v != 'unsupport' && v != 'unsupported') {
          liveProps[name] = '$v';
        }
      } catch (_) {
        // Property not implemented.
      }
      probeDone++;
      if (probeDone % 3 == 0) notifyListeners();
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }

    for (final c in queue) {
      try {
        await dev.send(c.method, c.params, 0).then((r) {
          findings[c.signature] =
              r.ok ? MethodStatus.works : MethodStatus.silent;
        });
      } on MiioException catch (e) {
        findings[c.signature] =
            e.methodAbsent ? MethodStatus.absent : MethodStatus.exists;
      }
      probeDone++;
      notifyListeners();
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }

    probing = false;
    await _save();
    notifyListeners();
  }

  List<Candidate> get confirmed => candidateCommands
      .where((c) =>
          findings[c.signature] == MethodStatus.works ||
          findings[c.signature] == MethodStatus.exists)
      .toList();

  void _note(String method, String detail, bool ok) {
    log.insert(0, LogEntry(method, detail, ok));
    if (log.length > 300) log.removeLast();
  }

  @override
  void dispose() {
    _device?.dispose();
    super.dispose();
  }
}

extension _FirstOrNull<T> on List<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
