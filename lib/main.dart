import 'package:flutter/material.dart';

import 'camera_model.dart';
import 'ui/connect_page.dart';
import 'ui/console_page.dart';
import 'ui/control_page.dart';
import 'ui/probe_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(DafangApp(model: CameraModel()..load()));
}

const seed = Color(0xFF17B3A6); // the teal Mi Home uses for its toggles

class DafangApp extends StatelessWidget {
  final CameraModel model;
  const DafangApp({super.key, required this.model});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dafang Control',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: seed,
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF0A0A0B),
      ),
      home: Shell(model: model),
    );
  }
}

class Shell extends StatefulWidget {
  final CameraModel model;
  const Shell({super.key, required this.model});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.model,
      builder: (context, _) {
        final m = widget.model;
        if (!m.connected) return ConnectPage(model: m);

        final pages = [
          ControlPage(model: m),
          ProbePage(model: m),
          ConsolePage(model: m),
        ];

        return Scaffold(
          body: SafeArea(child: pages[_tab]),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _tab,
            onDestinationSelected: (i) => setState(() => _tab = i),
            destinations: const [
              NavigationDestination(
                  icon: Icon(Icons.videocam_outlined),
                  selectedIcon: Icon(Icons.videocam),
                  label: 'Control'),
              NavigationDestination(
                  icon: Icon(Icons.biotech_outlined),
                  selectedIcon: Icon(Icons.biotech),
                  label: 'Probe'),
              NavigationDestination(
                  icon: Icon(Icons.terminal_outlined),
                  selectedIcon: Icon(Icons.terminal),
                  label: 'Console'),
            ],
          ),
        );
      },
    );
  }
}
