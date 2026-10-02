import 'package:flutter/widgets.dart';

import '../ui/theme.dart';

/// Hors navigateur, le lecteur ne peut pas s'afficher ici.
class StoryFrame extends StatelessWidget {
  const StoryFrame({super.key, required this.url});

  final String url;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text('Le lecteur s’ouvre dans un navigateur :\n$url', textAlign: TextAlign.center, style: Txt.body),
        ),
      );
}

class LoopVideo extends StatelessWidget {
  const LoopVideo({super.key, required this.url, this.poster});

  final String url;
  final String? poster;

  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}

VoidCallback listenToPlayer(void Function(String type) onMessage) => () {};

Uri pageOrigin() => Uri.parse('http://localhost:3000');
