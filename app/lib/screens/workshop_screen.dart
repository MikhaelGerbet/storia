// L'atelier : les histoires en fabrication, celles qui attendent leur tour, et les dernières terminées.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../app_scope.dart';
import '../data/api.dart';
import '../data/app_model.dart';
import '../data/models.dart';
import '../ui/format.dart';
import '../ui/story_visuals.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class WorkshopScreen extends StatefulWidget {
  const WorkshopScreen({super.key});

  @override
  State<WorkshopScreen> createState() => _WorkshopScreenState();
}

class _WorkshopScreenState extends State<WorkshopScreen> {
  late final AppModel _model;
  late final Timer _clock;

  @override
  void initState() {
    super.initState();
    _model = AppScope.of(context);
    _model.workshopVisible = true;
    _model.refreshCreations();
    _model.refreshHealth();
    // Les durées (« commencée il y a 3 min ») avancent même sans nouvelle du studio.
    _clock = Timer.periodic(const Duration(seconds: 15), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _model.workshopVisible = false;
    _clock.cancel();
    super.dispose();
  }

  Future<void> _act(Future<void> Function() action) async {
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.message, emoji: 'Warning');
    }
  }

  Future<void> _cancel(Creation creation) async {
    if (creation.state == CreationState.running) {
      final ok = await confirm(
        context,
        title: 'Arrêter cette histoire\u00A0?',
        text: 'Elle est en pleine fabrication. Tu pourras la relancer plus tard, depuis le début.',
        yes: 'Oui, arrêter',
        emoji: 'Hourglass not done',
        danger: true,
      );
      if (!ok) return;
    }
    await _act(() => _model.cancel(creation));
  }

  @override
  Widget build(BuildContext context) {
    final screen = screenOf(context);
    final insets = MediaQuery.paddingOf(context);
    return ValueListenableBuilder<Catalogue?>(
      valueListenable: _model.catalogue,
      builder: (context, catalogue, _) => ValueListenableBuilder<List<Creation>>(
        valueListenable: _model.creations,
        builder: (context, creations, _) {
          final running = creations.where((c) => c.state == CreationState.running).toList();
          final waiting = creations.where((c) => c.state == CreationState.waiting).toList()..sort((a, b) => (a.position ?? 99).compareTo(b.position ?? 99));
          final ended = creations.where((c) => !c.state.isPending).toList()..sort((a, b) => (b.finishedAt ?? b.requestedAt).compareTo(a.finishedAt ?? a.requestedAt));
          return LayoutBuilder(
            builder: (context, box) {
              final side = math.max(gutterOf(context), (box.maxWidth - 1000) / 2);
              return ListView(
                padding: EdgeInsets.fromLTRB(side, insets.top + (screen == ScreenSize.compact ? 22 : 10), side, insets.bottom + 40),
                children: [
                  const Eyebrow('Atelier', color: Palette.accent),
                  const SizedBox(height: 8),
                  Text('Ici, les histoires prennent vie', style: screen == ScreenSize.compact ? Txt.h1 : Txt.hero),
                  const SizedBox(height: 8),
                  Text('Une à la fois, avec soin\u00A0: le texte, la voix du conteur, puis l’illustration.', style: Txt.lead.copyWith(fontSize: screen == ScreenSize.compact ? 16 : 18)),
                  const SizedBox(height: 22),
                  _HealthNotice(model: _model),
                  if (creations.isEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 30),
                      child: EmptyState(
                        emoji: 'Sleeping face',
                        secondEmoji: 'Crescent moon',
                        title: 'L’atelier fait la sieste',
                        text: 'Aucune histoire en préparation. Et si tu en inventais une\u00A0?',
                        action: GlowButton(label: 'Inventer une histoire', emoji: 'Sparkles', onPressed: () => context.go('/creer')),
                      ),
                    ),
                  for (final c in running)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 18),
                      child: FadeSlideIn(key: ValueKey(c.id), child: _RunningCard(creation: c, catalogue: catalogue, onCancel: () => _cancel(c))),
                    ),
                  if (waiting.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Eyebrow('En attente · ${waiting.length}'),
                    const SizedBox(height: 12),
                    for (final c in waiting)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: FadeSlideIn(key: ValueKey(c.id), child: _WaitingRow(creation: c, catalogue: catalogue, onCancel: () => _cancel(c))),
                      ),
                  ],
                  if (ended.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    const Eyebrow('Dernières fabrications'),
                    const SizedBox(height: 12),
                    for (final c in ended.take(12))
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: FadeSlideIn(
                          key: ValueKey(c.id),
                          child: _EndedRow(
                            creation: c,
                            catalogue: catalogue,
                            onOpen: () => context.push('/histoire/${c.storyId}'),
                            onRetry: () => _act(() => _model.retry(c)),
                            onRemove: () => _act(() => _model.cancel(c)),
                            onDetails: () => _showDetails(context, _model.api, c),
                          ),
                        ),
                      ),
                  ],
                ],
              );
            },
          );
        },
      ),
    );
  }
}

/// Ce qui manque au studio pour fabriquer des histoires : un service à lancer.
class _HealthNotice extends StatelessWidget {
  const _HealthNotice({required this.model});

  final AppModel model;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<Health?>(
        valueListenable: model.health,
        builder: (context, health, _) {
          final problems = health?.problems ?? const <ServiceState>[];
          if (problems.isEmpty) return const SizedBox.shrink();
          return Padding(
            padding: const EdgeInsets.only(bottom: 18),
            child: Panel(
              gradient: LinearGradient(colors: [Palette.star.withValues(alpha: 0.14), Palette.surface.withValues(alpha: 0.92)]),
              borderColor: Palette.star.withValues(alpha: 0.4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Emoji('Warning', size: 40),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Le studio a besoin d’un coup de main', style: Txt.strong.copyWith(fontSize: 16.5)),
                        const SizedBox(height: 6),
                        for (final p in problems) Padding(padding: const EdgeInsets.only(top: 4), child: Text('• ${p.detail}', style: Txt.body.copyWith(fontSize: 14.5))),
                        const SizedBox(height: 6),
                        Text('Les histoires attendent sagement\u00A0: elles repartiront toutes seules.', style: Txt.small),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );
}

String _fallbackTitle(Creation c, Catalogue? catalogue) {
  final hero = catalogue?.ingredient(Kind.heros, c.composition[Kind.heros]);
  return hero == null ? 'Une nouvelle histoire' : 'L’histoire ${hero.afterDe}';
}

String _subtitle(Creation c, Catalogue? catalogue) {
  final theme = catalogue?.theme(c.composition.theme);
  final duration = catalogue?.durations.where((d) => d.id == c.composition.duration).firstOrNull;
  return [if (theme != null) theme.label, ageLabel(c.composition.age), if (duration != null) duration.label.toLowerCase()].join(' · ');
}

class _RunningCard extends StatelessWidget {
  const _RunningCard({required this.creation, required this.catalogue, required this.onCancel});

  final Creation creation;
  final Catalogue? catalogue;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final compact = screenOf(context) == ScreenSize.compact;
    final progress = creation.progress;
    final theme = catalogue?.theme(creation.composition.theme);
    final waitingFor = progress?.waitingFor;
    final started = creation.startedAt;
    final art = CompositionArt(composition: creation.composition, catalogue: catalogue, size: compact ? 96 : 132, animated: true);
    final details = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _LiveDot(color: waitingFor == null ? Palette.mint : Palette.star),
            const SizedBox(width: 8),
            Eyebrow(waitingFor == null ? 'En fabrication' : 'En pause', color: waitingFor == null ? Palette.mint : Palette.star),
          ],
        ),
        const SizedBox(height: 8),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 400),
          child: Text(creation.title ?? _fallbackTitle(creation, catalogue), key: ValueKey(creation.title), style: compact ? Txt.h2 : Txt.h1.copyWith(fontSize: 30)),
        ),
        const SizedBox(height: 4),
        Text(_subtitle(creation, catalogue), style: Txt.small),
      ],
    );
    return Panel(
      padding: EdgeInsets.all(compact ? 18 : 26),
      radius: Radii.big,
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [(theme?.colors.first ?? Palette.accent).withValues(alpha: 0.22), Palette.surface.withValues(alpha: 0.94), Palette.surface.withValues(alpha: 0.94)],
      ),
      borderColor: (theme?.colors.first ?? Palette.accent).withValues(alpha: 0.4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (compact)
            Row(crossAxisAlignment: CrossAxisAlignment.center, children: [art, const SizedBox(width: 18), Expanded(child: details)])
          else
            Row(crossAxisAlignment: CrossAxisAlignment.center, children: [art, const SizedBox(width: 28), Expanded(child: details)]),
          const SizedBox(height: 24),
          if (progress != null) _StepTrack(progress: progress, compact: compact),
          const SizedBox(height: 22),
          Row(
            children: [
              Expanded(child: GlowProgressBar(value: progress?.overall ?? 0.02, height: 14)),
              const SizedBox(width: 14),
              Text('${((progress?.overall ?? 0) * 100).round()}\u00A0%', style: Txt.h3.copyWith(fontSize: 20)),
            ],
          ),
          const SizedBox(height: 12),
          if (waitingFor != null)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: Palette.star.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(16), border: Border.all(color: Palette.star.withValues(alpha: 0.35))),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Emoji('Warning', size: 26),
                  const SizedBox(width: 10),
                  Expanded(child: Text('$waitingFor\nL’histoire repartira toute seule.', style: Txt.body.copyWith(fontSize: 14, color: Palette.text))),
                ],
              ),
            ),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            runSpacing: 10,
            spacing: 12,
            children: [
              Text(
                [
                  if (progress != null) '${progress.step.doing}${progress.detail != null && progress.step != MakingStep.texte ? ' · ${progress.detail}' : ''}',
                  if (started != null) 'commencée ${agoLabel(started)}',
                ].join(' — '),
                style: Txt.small.copyWith(color: Palette.textSoft),
              ),
              SoftButton(label: 'Arrêter', icon: Icons.stop_rounded, compact: true, color: Palette.rose, onPressed: onCancel),
            ],
          ),
        ],
      ),
    );
  }
}

class _LiveDot extends StatefulWidget {
  const _LiveDot({required this.color});

  final Color color;

  @override
  State<_LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<_LiveDot> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox.square(
        dimension: 14,
        child: AnimatedBuilder(
          animation: _pulse,
          builder: (context, _) => CustomPaint(
            painter: _DotPainter(widget.color, _pulse.value),
          ),
        ),
      );
}

class _DotPainter extends CustomPainter {
  _DotPainter(this.color, this.t);

  final Color color;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    canvas.drawCircle(center, 3 + 4 * t, Paint()..color = color.withValues(alpha: 0.5 * (1 - t)));
    canvas.drawCircle(center, 4, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_DotPainter old) => old.t != t || old.color != color;
}

/// Les étapes de fabrication, reliées comme un petit chemin : faites, en cours, à venir.
class _StepTrack extends StatelessWidget {
  const _StepTrack({required this.progress, required this.compact});

  final CreationProgress progress;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final steps = progress.steps.isEmpty ? [StepProgress(progress.step, progress.value)] : progress.steps;
    final current = steps.indexWhere((s) => s.step == progress.step);
    final children = <Widget>[];
    for (final (i, s) in steps.indexed) {
      final done = s.value >= 1 || (current >= 0 && i < current);
      final active = i == current && !done;
      if (i > 0) {
        children.add(
          Expanded(
            child: Container(
              height: 4,
              margin: EdgeInsets.only(bottom: compact ? 0 : 26),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(2),
                gradient: done || active ? const LinearGradient(colors: [Palette.mint, Palette.accent]) : null,
                color: done || active ? null : Colors.white.withValues(alpha: 0.1),
              ),
            ),
          ),
        );
      }
      children.add(_StepNode(step: s.step, value: s.value, done: done, active: active, compact: compact));
    }
    return Row(children: children);
  }
}

class _StepNode extends StatelessWidget {
  const _StepNode({required this.step, required this.value, required this.done, required this.active, required this.compact});

  final MakingStep step;
  final double value;
  final bool done;
  final bool active;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final size = compact ? 46.0 : 58.0;
    Widget node;
    if (active) {
      node = ProgressRing(value: value, size: size, stroke: 4, child: Floating(amplitude: 2.5, period: const Duration(milliseconds: 1600), child: Emoji(step.emoji, size: size * 0.56)));
    } else {
      node = Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: done ? Palette.mint.withValues(alpha: 0.18) : Colors.white.withValues(alpha: 0.05),
          border: Border.all(color: done ? Palette.mint.withValues(alpha: 0.7) : Palette.line, width: 2),
        ),
        child: Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            Opacity(opacity: done ? 1 : 0.35, child: Emoji(step.emoji, size: size * 0.52)),
            if (done)
              Positioned(
                right: -4,
                bottom: -4,
                child: Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: Palette.mint, border: Border.all(color: Palette.surface, width: 2)),
                  child: const Icon(Icons.check_rounded, size: 14, color: Palette.abyss),
                ),
              ),
          ],
        ),
      );
    }
    return Tooltip(
      message: step.label,
      child: compact
          ? node
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                node,
                const SizedBox(height: 8),
                Text(step.label, style: Txt.small.copyWith(color: active ? Palette.text : (done ? Palette.textSoft : Palette.textMute), fontWeight: active ? FontWeight.w900 : FontWeight.w700)),
              ],
            ),
    );
  }
}

class _WaitingRow extends StatelessWidget {
  const _WaitingRow({required this.creation, required this.catalogue, required this.onCancel});

  final Creation creation;
  final Catalogue? catalogue;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) => Panel(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        radius: 22,
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(shape: BoxShape.circle, color: Palette.surfaceTop, border: Border.all(color: Palette.lineStrong)),
              child: Text('${creation.position ?? '…'}', style: Txt.strong.copyWith(fontSize: 15)),
            ),
            const SizedBox(width: 12),
            CompositionArt(composition: creation.composition, catalogue: catalogue, size: 56),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_fallbackTitle(creation, catalogue), maxLines: 1, overflow: TextOverflow.ellipsis, style: Txt.strong.copyWith(fontSize: 16)),
                  const SizedBox(height: 2),
                  Text('${creation.position == 1 ? 'La prochaine' : 'Attend son tour'} · ${_subtitle(creation, catalogue)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: Txt.small),
                ],
              ),
            ),
            RoundButton(icon: Icons.close_rounded, tooltip: 'Retirer de la file', size: 40, background: Palette.surfaceTop, onPressed: onCancel),
          ],
        ),
      );
}

class _EndedRow extends StatelessWidget {
  const _EndedRow({required this.creation, required this.catalogue, required this.onOpen, required this.onRetry, required this.onRemove, required this.onDetails});

  final Creation creation;
  final Catalogue? catalogue;
  final VoidCallback onOpen;
  final VoidCallback onRetry;
  final VoidCallback onRemove;
  final VoidCallback onDetails;

  @override
  Widget build(BuildContext context) {
    final compact = screenOf(context) == ScreenSize.compact;
    final done = creation.state == CreationState.done;
    final failed = creation.state == CreationState.failed;
    final when = creation.finishedAt == null ? '' : agoLabel(creation.finishedAt!);
    final status = done ? 'Prête $when' : (failed ? 'Un souci est survenu $when' : 'Arrêtée $when');
    final firstLine = creation.error?.split('\n').first;
    final actions = <Widget>[
      if (done) GlowButton(label: 'Écouter', emoji: 'Headphone', onPressed: onOpen),
      if (!done) SoftButton(label: failed ? 'Réessayer' : 'Relancer', icon: Icons.refresh_rounded, compact: true, onPressed: onRetry),
      if (failed) SoftButton(label: 'Détails', compact: true, onPressed: onDetails),
      RoundButton(icon: Icons.close_rounded, tooltip: 'Retirer de la liste', size: 40, background: Palette.surfaceTop, onPressed: onRemove),
    ];
    return Panel(
      padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
      radius: 22,
      borderColor: failed ? Palette.rose.withValues(alpha: 0.35) : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Opacity(opacity: done ? 1 : 0.6, child: CompositionArt(composition: creation.composition, catalogue: catalogue, size: 56)),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(creation.title ?? _fallbackTitle(creation, catalogue), maxLines: 1, overflow: TextOverflow.ellipsis, style: Txt.strong.copyWith(fontSize: 16)),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Icon(done ? Icons.check_circle_rounded : (failed ? Icons.error_rounded : Icons.pause_circle_rounded), size: 15, color: done ? Palette.mint : (failed ? Palette.rose : Palette.textMute)),
                        const SizedBox(width: 5),
                        Flexible(child: Text(status, maxLines: 1, overflow: TextOverflow.ellipsis, style: Txt.small)),
                      ],
                    ),
                    if (failed && firstLine != null) ...[
                      const SizedBox(height: 4),
                      Text(firstLine, maxLines: 2, overflow: TextOverflow.ellipsis, style: Txt.small.copyWith(color: Palette.rose.withValues(alpha: 0.9))),
                    ],
                  ],
                ),
              ),
              if (!compact) ...[const SizedBox(width: 12), Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: actions)],
            ],
          ),
          if (compact) ...[const SizedBox(height: 12), Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.end, crossAxisAlignment: WrapCrossAlignment.center, children: actions)],
        ],
      ),
    );
  }
}

/// Le détail d'un échec, avec le journal de fabrication, pour les parents.
Future<void> _showDetails(BuildContext context, StoriaApi api, Creation creation) => showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760, maxHeight: 640),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 20, 24, 22),
            child: FutureBuilder<List<String>>(
              future: api.journal(creation.id),
              builder: (context, snapshot) {
                final journal = snapshot.data ?? const <String>[];
                final text = [creation.error ?? '', if (journal.isNotEmpty) '\n— Journal de fabrication —', ...journal].join('\n');
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const Emoji('Warning', size: 34),
                        const SizedBox(width: 12),
                        Expanded(child: Text('Ce qui s’est passé', style: Txt.h2)),
                        RoundButton(icon: Icons.copy_rounded, tooltip: 'Copier', size: 40, background: Palette.surfaceTop, onPressed: () => Clipboard.setData(ClipboardData(text: text))),
                        const SizedBox(width: 8),
                        RoundButton(icon: Icons.close_rounded, tooltip: 'Fermer', size: 40, background: Palette.surfaceTop, onPressed: () => Navigator.of(context).pop()),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Flexible(
                      child: Container(
                        decoration: BoxDecoration(color: Palette.abyss, borderRadius: BorderRadius.circular(16), border: Border.all(color: Palette.line)),
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.all(16),
                          child: SelectableText(text, style: const TextStyle(fontFamily: 'monospace', fontSize: 13, height: 1.5, color: Palette.textSoft)),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
