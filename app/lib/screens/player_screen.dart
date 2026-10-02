// L'écoute : le lecteur de l'histoire en plein écran (sons, voix, illustration animée).
// Il prévient l'application quand l'histoire commence (une écoute de plus) et quand on veut le quitter.
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../app_scope.dart';
import '../data/api.dart';
import '../data/app_model.dart';
import '../data/models.dart';
import '../platform/html_view.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key, required this.id});

  final String id;

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  late final AppModel _model;
  late final VoidCallback _stopListening;
  Story? _story;
  String? _error;
  bool _counted = false;

  @override
  void initState() {
    super.initState();
    _model = AppScope.of(context);
    _stopListening = listenToPlayer(_onMessage);
    _load();
  }

  @override
  void dispose() {
    _stopListening();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final story = await _model.api.story(widget.id);
      if (mounted) setState(() => _story = story);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _onMessage(String type) {
    switch (type) {
      case 'storia:lecture':
        // Une écoute par ouverture du lecteur, même si on réécoute à la fin.
        if (_counted) return;
        _counted = true;
        _model.api.countRead(widget.id).then((_) => _model.libraryChanged(), onError: (Object _) {});
      case 'storia:fermer':
        _close();
    }
  }

  void _close() => context.canPop() ? context.pop() : context.go('/histoire/${widget.id}');

  @override
  Widget build(BuildContext context) {
    final story = _story;
    final insets = MediaQuery.paddingOf(context);
    return Scaffold(
      backgroundColor: Palette.abyss,
      body: Stack(
        children: [
          Positioned.fill(
            child: story != null
                ? StoryFrame(url: '${_model.api.url(story.player)}?app&auto')
                : (_error != null ? ErrorPanel(message: _error!, onRetry: _load) : const Center(child: CircularProgressIndicator(color: Palette.accent))),
          ),
          Positioned(
            left: 14,
            top: insets.top + 12,
            child: RoundButton(icon: Icons.arrow_back_rounded, tooltip: 'Quitter l’histoire', onPressed: _close),
          ),
        ],
      ),
    );
  }
}
