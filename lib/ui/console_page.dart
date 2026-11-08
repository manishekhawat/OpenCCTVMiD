import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../camera_model.dart';

/// Raw miIO console — send any method with any params and read the reply.
class ConsolePage extends StatefulWidget {
  final CameraModel model;
  const ConsolePage({super.key, required this.model});

  @override
  State<ConsolePage> createState() => _ConsolePageState();
}

class _ConsolePageState extends State<ConsolePage> {
  final _method = TextEditingController(text: 'miIO.info');
  final _params = TextEditingController(text: '[]');
  String? _error;

  Future<void> _send() async {
    List<dynamic> parsed;
    try {
      final decoded = jsonDecode(_params.text);
      parsed = decoded is List ? decoded : [decoded];
    } catch (e) {
      setState(() => _error = 'Params must be valid JSON: $e');
      return;
    }
    setState(() => _error = null);
    await widget.model.call(_method.text.trim(), parsed);
  }

  @override
  Widget build(BuildContext context) {
    final log = widget.model.log;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 3,
                    child: TextField(
                      controller: _method,
                      style: const TextStyle(fontFamily: 'monospace'),
                      decoration: const InputDecoration(
                        labelText: 'method',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _params,
                      style: const TextStyle(fontFamily: 'monospace'),
                      decoration: const InputDecoration(
                        labelText: 'params',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                      onPressed: _send, icon: const Icon(Icons.send)),
                ],
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_error!,
                      style:
                          TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: log.isEmpty
              ? Center(
                  child: Text('Nothing sent yet',
                      style: TextStyle(
                          color:
                              Theme.of(context).colorScheme.onSurfaceVariant)),
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: log.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, i) {
                    final e = log[i];
                    return InkWell(
                      onLongPress: () {
                        Clipboard.setData(
                            ClipboardData(text: '${e.method}\n${e.detail}'));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Copied'),
                              duration: Duration(seconds: 1)),
                        );
                      },
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                e.ok ? Icons.check_circle : Icons.error_outline,
                                size: 14,
                                color: e.ok
                                    ? Colors.greenAccent
                                    : Theme.of(context).colorScheme.error,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(e.method,
                                    style: const TextStyle(
                                        fontFamily: 'monospace',
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600)),
                              ),
                              Text(
                                '${e.at.hour.toString().padLeft(2, '0')}:'
                                '${e.at.minute.toString().padLeft(2, '0')}:'
                                '${e.at.second.toString().padLeft(2, '0')}',
                                style: const TextStyle(
                                    fontSize: 11, color: Colors.white38),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Padding(
                            padding: const EdgeInsets.only(left: 22),
                            child: Text(
                              e.detail,
                              style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 11,
                                  color: Colors.white60),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
