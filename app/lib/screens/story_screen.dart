// La fiche d'une histoire : son illustration (animée si elle l'est), son résumé, ses mots-clés, et le bouton pour l'écouter.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../app_scope.dart';
import '../data/api.dart';
import '../data/app_model.dart';
import '../data/models.dart';
import '../platform/html_view.dart';
import '../ui/format.dart';
import '../ui/story_visuals.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class StoryScreen extends StatefulWidget {
  const StoryScreen({super.key, required this.id});

  final String id;

  @override
  State<StoryScreen> createState() => _StoryScreenState();
}

class _StoryScreenState extends State<StoryScreen> {
  late final AppModel _model;
  Story? _story;
  String? _error;
  bool _showText = false;

  @override
  void initState() {
    super.initState();
    _model = AppScope.of(context);
    _model.libraryVersion.addListener(_load);
    _load();
  }

  @override
  void dispose() {
    _model.libraryVersion.removeListener(_load);
    scheduleMicrotask(() => _model.clearGlow(this));
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final story = await _model.api.story(widget.id);
      if (!mounted) return;
      setState(() => _story = story);
      _model.setGlow(this, _model.catalogue.value?.theme(story.theme)?.colors);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _toggleFavorite() async {
    final story = _story;
    if (story == null) return;
    try {
      final updated = await _model.api.setFavorite(story.id, !story.favorite);
      if (!mounted) return;
      setState(() => _story = updated);
      if (updated.favorite) showToast(context, 'Ajoutée à tes favoris', emoji: 'Red heart');
      _model.libraryChanged();
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.message, emoji: 'Warning');
    }
  }

  Future<void> _delete() async {
    final story = _story;
    if (story == null) return;
    final ok = await confirm(context, title: 'Supprimer «\u00A0${story.title}\u00A0»\u00A0?', text: 'L’histoire, sa voix et son illustration disparaîtront de la bibliothèque.', yes: 'Supprimer', emoji: 'Wastebasket', danger: true);
    if (!ok || !mounted) return;
    try {
      await _model.api.deleteStory(story.id);
      _model.libraryChanged();
      if (!mounted) return;
      showToast(context, 'Histoire supprimée', emoji: 'Check mark button');
      context.go('/');
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.message, emoji: 'Warning');
    }
  }

  void _similar() {
    final c = _story?.composition;
    if (c == null) return;
    _model.setDraft(Composition(theme: c.theme, picks: c.picks, age: c.age, duration: c.duration));
    context.go('/creer');
  }

  void _back() => context.canPop() ? context.pop() : context.go('/');

  @override
  Widget build(BuildContext context) {
    final insets = MediaQuery.paddingOf(context);
    final story = _story;
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: story == null
          ? (_error != null
              ? ErrorPanel(message: _error!, onRetry: _load)
              : const Center(child: CircularProgressIndicator(color: Palette.accent)))
          : ValueListenableBuilder<Catalogue?>(
              valueListenable: _model.catalogue,
              builder: (context, catalogue, _) => LayoutBuilder(
                builder: (context, box) {
                  final screen = screenOf(context);
                  final side = math.max(gutterOf(context), (box.maxWidth - 1240) / 2);
                  final media = _Media(story: story, catalogue: catalogue, api: _model.api, onPlay: () => context.push('/ecouter/${story.id}'));
                  final info = _Info(
                    story: story,
                    catalogue: catalogue,
                    showText: _showText,
                    onPlay: () => context.push('/ecouter/${story.id}'),
                    onToggleText: () => setState(() => _showText = !_showText),
                    onKeyword: (k) => context.go(Uri(path: '/', queryParameters: {'q': k}).toString()),
                    onSimilar: story.composition == null ? null : _similar,
                    onDelete: _delete,
                  );
                  return ListView(
                    padding: EdgeInsets.fromLTRB(side, insets.top + 14, side, insets.bottom + 48),
                    children: [
                      Row(
                        children: [
                          RoundButton(icon: Icons.arrow_back_rounded, tooltip: 'Retour', onPressed: _back),
                          const Spacer(),
                          RoundButton(
                            icon: story.favorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                            color: story.favorite ? Palette.rose : null,
                            tooltip: story.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris',
                            onPressed: _toggleFavorite,
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      if (screen == ScreenSize.wide)
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(flex: 7, child: FadeSlideIn(child: media)),
                            const SizedBox(width: 36),
                            Expanded(flex: 5, child: FadeSlideIn(delay: const Duration(milliseconds: 120), child: info)),
                          ],
                        )
                      else ...[
                        FadeSlideIn(child: media),
                        const SizedBox(height: 26),
                        FadeSlideIn(delay: const Duration(milliseconds: 120), child: info),
                      ],
                    ],
                  );
                },
              ),
            ),
    );
  }
}

class _Media extends StatelessWidget {
  const _Media({required this.story, required this.catalogue, required this.api, required this.onPlay});

  final Story story;
  final Catalogue? catalogue;
  final StoriaApi api;
  final VoidCallback onPlay;

  @override
  Widget build(BuildContext context) {
    final theme = catalogue?.theme(story.theme);
    final loop = story.loop;
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.big),
        boxShadow: [
          BoxShadow(color: (theme?.colors.first ?? Palette.accent).withValues(alpha: 0.35), blurRadius: 60, offset: const Offset(0, 24)),
          const BoxShadow(color: Color(0x88000000), blurRadius: 24, offset: Offset(0, 10)),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      foregroundDecoration: BoxDecoration(borderRadius: BorderRadius.circular(Radii.big), border: Border.all(color: Colors.white.withValues(alpha: 0.12))),
      child: AspectRatio(
        aspectRatio: 16 / 10,
        child: Stack(
          fit: StackFit.expand,
          children: [
            // Le thème est écrit à côté, et le coin du bas est au bouton de lecture.
            StoryCover(story: story, catalogue: catalogue, api: api, emojiScale: 0.42, themeBadge: false),
            if (loop != null) LoopVideo(url: api.url(loop), poster: story.cover == null ? null : api.url(story.cover!)),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00060A14), Color(0x00060A14), Color(0xAA060A14)], stops: [0, 0.55, 1]),
              ),
            ),
            Positioned(right: 20, bottom: 20, child: _PlayOrb(onTap: onPlay)),
            if (loop != null)
              const Positioned(left: 16, bottom: 16, child: MetaPill(text: 'Illustration animée', emoji: 'Clapper board', background: Color(0x99060A14), color: Palette.text)),
          ],
        ),
      ),
    );
  }
}

/// Le gros bouton rond posé sur l'illustration.
class _PlayOrb extends StatelessWidget {
  const _PlayOrb({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onTap,
        radius: 60,
        hoverScale: 1.08,
        semanticLabel: 'Écouter l’histoire',
        child: Container(
          width: 92,
          height: 92,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: Palette.accentGradient,
            border: Border.all(color: Colors.white.withValues(alpha: 0.6), width: 3),
            boxShadow: [BoxShadow(color: Palette.accentHot.withValues(alpha: 0.6), blurRadius: 40)],
          ),
          child: const Padding(padding: EdgeInsets.only(left: 5), child: Icon(Icons.play_arrow_rounded, size: 56, color: Palette.accentInk)),
        ),
      );
}

class _Info extends StatelessWidget {
  const _Info({
    required this.story,
    required this.catalogue,
    required this.showText,
    required this.onPlay,
    required this.onToggleText,
    required this.onKeyword,
    required this.onSimilar,
    required this.onDelete,
  });

  final Story story;
  final Catalogue? catalogue;
  final bool showText;
  final VoidCallback onPlay;
  final VoidCallback onToggleText;
  final ValueChanged<String> onKeyword;
  final VoidCallback? onSimilar;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final compact = screenOf(context) == ScreenSize.compact;
    final theme = catalogue?.theme(story.theme);
    final composition = story.composition;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (theme != null)
          Container(
            padding: const EdgeInsets.fromLTRB(6, 4, 14, 4),
            decoration: BoxDecoration(gradient: theme.gradient, borderRadius: BorderRadius.circular(Radii.pill)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [Emoji(theme.emoji, size: 26), const SizedBox(width: 6), Text(theme.label, style: Txt.strong.copyWith(color: Colors.white, fontSize: 14))],
            ),
          ),
        const SizedBox(height: 16),
        Text(story.title, style: compact ? Txt.h1 : Txt.hero.copyWith(fontSize: 42)),
        if (story.teaser.isNotEmpty) ...[const SizedBox(height: 12), Text(story.teaser, style: Txt.lead)],
        const SizedBox(height: 18),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            MetaPill(text: story.durationLabel, icon: Icons.schedule_rounded),
            MetaPill(text: plural(story.reads, 'écoute'), emoji: 'Headphone'),
            MetaPill(text: ageLabel(story.age), emoji: 'Teddy bear'),
            MetaPill(text: 'Créée ${dayLabel(story.createdAt)}', icon: Icons.auto_awesome_rounded),
          ],
        ),
        const SizedBox(height: 26),
        SizedBox(width: compact ? double.infinity : null, child: GlowButton(label: 'Écouter l’histoire', icon: Icons.play_arrow_rounded, big: true, onPressed: onPlay)),
        if (story.keywords.isNotEmpty) ...[
          const SizedBox(height: 28),
          const Eyebrow('Mots-clés'),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final k in story.keywords)
                Pressable(
                  onTap: () => onKeyword(k),
                  radius: Radii.pill,
                  semanticLabel: 'Chercher les histoires avec $k',
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(Radii.pill), border: Border.all(color: Palette.lineStrong)),
                    child: Text('#$k', style: Txt.strong.copyWith(fontSize: 14, color: Palette.textSoft)),
                  ),
                ),
            ],
          ),
        ],
        if (composition != null && catalogue != null) ...[
          const SizedBox(height: 28),
          const Eyebrow('Les ingrédients'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final kind in Kind.values)
                if (catalogue!.ingredient(kind, composition[kind]) case final ingredient?)
                  Tooltip(
                    message: '${kind.label}\u00A0: ${ingredient.text}',
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(6, 6, 14, 6),
                      decoration: BoxDecoration(color: Palette.surfaceHigh, borderRadius: BorderRadius.circular(18), border: Border.all(color: Palette.line)),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [Emoji(ingredient.emoji, size: 34), const SizedBox(width: 8), Text(ingredient.label, style: Txt.strong.copyWith(fontSize: 14))],
                      ),
                    ),
                  ),
            ],
          ),
          if (onSimilar != null) ...[
            const SizedBox(height: 14),
            SoftButton(label: 'Inventer une histoire semblable', emoji: 'Sparkles', onPressed: onSimilar),
          ],
        ],
        if (story.text != null && story.text!.isNotEmpty) ...[
          const SizedBox(height: 28),
          Pressable(
            onTap: onToggleText,
            radius: 14,
            hoverScale: 1.0,
            semanticLabel: showText ? 'Cacher le texte' : 'Lire le texte',
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Emoji('Open book', size: 28),
                  const SizedBox(width: 10),
                  Text(showText ? 'Cacher le texte' : 'Lire le texte de l’histoire', style: Txt.strong),
                  AnimatedRotation(turns: showText ? 0.5 : 0, duration: const Duration(milliseconds: 250), child: const Icon(Icons.expand_more_rounded, color: Palette.textSoft)),
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: !showText
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Panel(child: SelectableText(story.text!, style: Txt.lead.copyWith(fontFamily: Fonts.display, fontWeight: FontWeight.w600, color: Palette.text, height: 1.65))),
                  ),
          ),
        ],
        const SizedBox(height: 30),
        TextButton.icon(
          onPressed: onDelete,
          icon: const Icon(Icons.delete_outline_rounded, color: Palette.textMute, size: 20),
          label: Text('Supprimer cette histoire', style: Txt.small.copyWith(color: Palette.textMute)),
        ),
      ],
    );
  }
}
