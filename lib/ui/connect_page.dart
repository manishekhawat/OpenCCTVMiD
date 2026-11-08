import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../camera_model.dart';
import '../miio/device.dart';

class ConnectPage extends StatefulWidget {
  final CameraModel model;
  const ConnectPage({super.key, required this.model});

  @override
  State<ConnectPage> createState() => _ConnectPageState();
}

class _ConnectPageState extends State<ConnectPage> {
  late final _ip = TextEditingController(text: widget.model.ip);
  late final _token = TextEditingController(text: widget.model.token);
  List<Discovered>? _found;
  bool _scanning = false;

  Future<void> _scan() async {
    setState(() {
      _scanning = true;
      _found = null;
    });
    final results = await discover();
    if (!mounted) return;
    setState(() {
      _scanning = false;
      _found = results;
    });
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.model;
    final valid = _token.text.replaceAll(RegExp(r'[^0-9a-fA-F]'), '').length == 32;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 32, 20, 32),
          children: [
            Text('Dafang Control',
                style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 6),
            Text('Local miIO on UDP 54321 — no cloud, no Mi Home.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 28),

            TextField(
              controller: _ip,
              keyboardType: TextInputType.text,
              decoration: const InputDecoration(
                labelText: 'Camera IP',
                border: OutlineInputBorder(),
                helperText: 'Mi Home ▸ ⋯ ▸ Network info',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _token,
              onChanged: (_) => setState(() {}),
              style: const TextStyle(fontFamily: 'monospace'),
              inputFormatters: [LengthLimitingTextInputFormatter(40)],
              decoration: InputDecoration(
                labelText: 'Device token',
                border: const OutlineInputBorder(),
                helperText: '32 hex characters',
                suffixIcon: valid
                    ? const Icon(Icons.check_circle, color: Colors.greenAccent)
                    : null,
              ),
            ),
            const SizedBox(height: 20),

            FilledButton.icon(
              onPressed: (!valid || m.connecting)
                  ? null
                  : () => m.connect(_ip.text, _token.text),
              icon: m.connecting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.link),
              label: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(m.connecting ? 'Connecting…' : 'Connect'),
              ),
            ),

            if (m.connectionError != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  m.connectionError!,
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.onErrorContainer),
                ),
              ),
            ],

            const SizedBox(height: 28),
            OutlinedButton.icon(
              onPressed: _scanning ? null : _scan,
              icon: const Icon(Icons.wifi_find),
              label: Text(_scanning ? 'Scanning…' : 'Scan the network'),
            ),

            if (_found != null) ...[
              const SizedBox(height: 12),
              if (_found!.isEmpty)
                const _Hint(
                    'Nothing answered. The camera may be asleep, on another '
                    'subnet, or the router may be isolating Wi-Fi clients.')
              else
                ..._found!.map((d) => Card(
                      child: ListTile(
                        title: Text(d.ip),
                        subtitle: Text(d.token == null
                            ? 'id ${d.deviceId} · token not disclosed'
                            : 'id ${d.deviceId} · token leaked by firmware'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => setState(() {
                          _ip.text = d.ip;
                          if (d.token != null) _token.text = d.token!;
                        }),
                      ),
                    )),
            ],

            const SizedBox(height: 32),
            const Divider(),
            const SizedBox(height: 16),
            Text('Getting the token',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            const _Hint(
              'The token is the camera\'s local password — 16 bytes, never sent '
              'over the wire, used to derive the AES key. Mi Home holds it.\n\n'
              '1. Easiest: run Xiaomi-cloud-tokens-extractor on a PC and sign '
              'in with your Mi account.\n'
              '2. Or pull /data/data/com.xiaomi.smarthome/databases/miio2.db '
              'from a rooted device or an emulator.\n\n'
              'Resetting the camera or re-adding it in Mi Home changes the '
              'token.',
            ),
          ],
        ),
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  final String text;
  const _Hint(this.text);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
      );
}
