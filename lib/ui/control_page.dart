import 'package:flutter/material.dart';

import '../camera_model.dart';
import '../commands.dart';

class ControlPage extends StatelessWidget {
  final CameraModel model;
  const ControlPage({super.key, required this.model});

  @override
  Widget build(BuildContext context) {
    final confirmed = model.confirmed;
    final groups = <String, List<Candidate>>{};
    for (final c in confirmed) {
      groups.putIfAbsent(c.group, () => []).add(c);
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        _Header(model: model),
        const SizedBox(height: 20),
        _PtzPad(model: model),
        const SizedBox(height: 24),

        if (confirmed.isEmpty)
          Card(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('No commands confirmed yet',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  SizedBox(height: 8),
                  Text(
                    'Xiaomi never published the method list for this camera, '
                    'so the app has to ask yours what it understands. Run the '
                    'sweep on the Probe tab; whatever answers shows up here.',
                  ),
                ],
              ),
            ),
          )
        else
          ...groups.entries.map((e) => _Group(
                title: e.key,
                children: e.value,
                model: model,
              )),

        if (model.liveProps.isNotEmpty) ...[
          const SizedBox(height: 8),
          _Group.props(model.liveProps),
        ],
      ],
    );
  }
}

class _Header extends StatelessWidget {
  final CameraModel model;
  const _Header({required this.model});

  @override
  Widget build(BuildContext context) {
    final info = model.deviceInfo ?? const {};
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: const BoxDecoration(
              color: Colors.greenAccent, shape: BoxShape.circle),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(info['model']?.toString() ?? 'camera',
                  style: Theme.of(context).textTheme.titleMedium),
              Text(
                '${model.ip} · fw ${info['fw_ver'] ?? '?'}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
        IconButton(
          icon: const Icon(Icons.logout),
          tooltip: 'Disconnect',
          onPressed: model.disconnect,
        ),
      ],
    );
  }
}

class _PtzPad extends StatefulWidget {
  final CameraModel model;
  const _PtzPad({required this.model});

  @override
  State<_PtzPad> createState() => _PtzPadState();
}

class _PtzPadState extends State<_PtzPad> {
  String? _busy;
  String? _message;

  Future<void> _go(String direction) async {
    setState(() {
      _busy = direction;
      _message = null;
    });
    final ok = await widget.model.nudge(direction);
    if (!mounted) return;
    setState(() {
      _busy = null;
      _message = ok
          ? null
          : 'No motor command accepted for "$direction". Probe first, or '
              'this firmware may keep PTZ on the P2P channel only.';
    });
  }

  Widget _btn(String direction, IconData icon, {bool wide = false}) {
    final known = widget.model.preferredPtz(direction) != null;
    return SizedBox(
      width: wide ? 72 : 64,
      height: 64,
      child: _busy == direction
          ? const Center(
              child: SizedBox(
                  width: 20, height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2)))
          : IconButton.filledTonal(
              onPressed: _busy != null ? null : () => _go(direction),
              icon: Icon(icon, size: 28),
              style: known
                  ? IconButton.styleFrom(
                      backgroundColor:
                          Theme.of(context).colorScheme.primaryContainer)
                  : null,
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _btn('up', Icons.keyboard_arrow_up),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _btn('left', Icons.keyboard_arrow_left),
            const SizedBox(width: 56),
            _btn('right', Icons.keyboard_arrow_right),
          ],
        ),
        _btn('down', Icons.keyboard_arrow_down),
        if (_message != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              _message!,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: Theme.of(context).colorScheme.error, fontSize: 13),
            ),
          ),
      ],
    );
  }
}

class _Group extends StatelessWidget {
  final String title;
  final List<Candidate> children;
  final CameraModel? model;
  final Map<String, String>? props;

  const _Group({
    required this.title,
    required this.children,
    required this.model,
  }) : props = null;

  const _Group.props(Map<String, String> p)
      : title = 'Reported state',
        children = const [],
        model = null,
        props = p;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title.toUpperCase(),
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    letterSpacing: 1.2,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  )),
          const SizedBox(height: 10),
          if (props != null)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: props!.entries
                  .map((e) => Chip(label: Text('${e.key}: ${e.value}')))
                  .toList(),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: children
                  .map((c) => ActionChip(
                        label: Text(c.label),
                        avatar: c.destructive
                            ? const Icon(Icons.warning_amber, size: 16)
                            : null,
                        onPressed: () => _fire(context, c),
                      ))
                  .toList(),
            ),
        ],
      ),
    );
  }

  Future<void> _fire(BuildContext context, Candidate c) async {
    if (c.destructive) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(c.label),
          content: Text('${c.signature}\n\nThis cannot be undone.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Run it')),
          ],
        ),
      );
      if (ok != true) return;
    }
    final r = await model!.call(c.method, c.params);
    if (!context.mounted || r == null) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(r.ok ? '${c.signature} → ${r.value}' : '${r.error}'),
      duration: const Duration(seconds: 2),
    ));
  }
}
