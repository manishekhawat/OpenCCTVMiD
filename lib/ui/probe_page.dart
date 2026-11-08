import 'package:flutter/material.dart';

import '../camera_model.dart';
import '../commands.dart';

class ProbePage extends StatelessWidget {
  final CameraModel model;
  const ProbePage({super.key, required this.model});

  @override
  Widget build(BuildContext context) {
    final tested = candidateCommands
        .where((c) => model.findings.containsKey(c.signature))
        .toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text('Capability probe',
            style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(
          'The sweep calls each candidate once and reads the camera\'s reply. '
          '"unsupported_method" means the name is wrong; "invalid params" is '
          'the useful answer — it proves the method exists and only the '
          'arguments were off.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 20),

        if (model.probing) ...[
          LinearProgressIndicator(
            value: model.probeTotal == 0
                ? null
                : model.probeDone / model.probeTotal,
          ),
          const SizedBox(height: 8),
          Text('${model.probeDone} of ${model.probeTotal}',
              style: Theme.of(context).textTheme.bodySmall),
        ] else
          FilledButton.icon(
            onPressed: () => model.runProbe(),
            icon: const Icon(Icons.play_arrow),
            label: const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Run the sweep'),
            ),
          ),

        const SizedBox(height: 10),
        Text(
          'Takes about a minute. Destructive methods such as sdcard_format are '
          'listed but never fired.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),

        if (model.liveProps.isNotEmpty) ...[
          const SizedBox(height: 28),
          const _SectionLabel('Properties that answered'),
          const SizedBox(height: 10),
          ...model.liveProps.entries.map((e) => ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(e.key,
                    style: const TextStyle(fontFamily: 'monospace')),
                trailing: Text(e.value),
              )),
        ],

        if (tested.isNotEmpty) ...[
          const SizedBox(height: 28),
          const _SectionLabel('Results'),
          const SizedBox(height: 4),
          ...tested.map((c) => _Row(
                candidate: c,
                status: model.findings[c.signature]!,
              )),
        ],
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) => Text(
        text.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              letterSpacing: 1.2,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
      );
}

class _Row extends StatelessWidget {
  final Candidate candidate;
  final MethodStatus status;
  const _Row({required this.candidate, required this.status});

  (Color, String) get _badge => switch (status) {
        MethodStatus.works => (Colors.greenAccent, 'works'),
        MethodStatus.exists => (Colors.amberAccent, 'exists'),
        MethodStatus.absent => (Colors.white24, 'absent'),
        MethodStatus.silent => (Colors.orangeAccent, 'silent'),
        MethodStatus.untested => (Colors.white24, '—'),
      };

  @override
  Widget build(BuildContext context) {
    final (color, text) = _badge;
    final dim = status == MethodStatus.absent;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              candidate.signature,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: dim ? Colors.white30 : null,
              ),
            ),
          ),
          Text(text,
              style: TextStyle(fontSize: 11, color: color.withOpacity(0.9))),
        ],
      ),
    );
  }
}
