// Créer une histoire : six cases à remplir (thème, héros, lieu, compagnon, objet, surprise), ou un coup de dé.
// Ce qu'on choisit soi-même est verrouillé : le dé ne tire au sort que le reste.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../app_scope.dart';
import '../data/api.dart';
import '../data/app_model.dart';
import '../data/models.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Une case : le thème (null) ou un ingrédient.
typedef Slot = Kind?;

String? _valueOf(Composition c, Slot slot) => slot == null ? c.theme : c[slot];

Composition _withValue(Composition c, Slot slot, String? id) => slot == null ? c.withTheme(id) : c.withPick(slot, id);

const _slots = <Slot>[null, Kind.heros, Kind.lieu, Kind.compagnon, Kind.objet, Kind.rebondissement];

const _shortDurations = {'courte': '≈ 1 min', 'moyenne': '2-3 min', 'longue': '4-5 min'};

class CreateScreen extends StatefulWidget {
  const CreateScreen({super.key});

  @override
  State<CreateScreen> createState() => _CreateScreenState();
}

class _CreateScreenState extends State<CreateScreen> with SingleTickerProviderStateMixin {
  late final AppModel _model;
  late final AnimationController _dice = AnimationController(vsync: this, duration: const Duration(milliseconds: 650));
  late final TextEditingController _idea;
  final _locked = <Slot>{};
  final _rolling = <Slot>{};
  bool _busy = false;
  bool? _settingsOpen;

  @override
  void initState() {
    super.initState();
    _model = AppScope.of(context);
    final draft = _model.draft.value;
    _idea = TextEditingController(text: draft.idea);
    // Ce qui vient d'ailleurs (« une histoire semblable ») est gardé tel quel au prochain coup de dé.
    for (final slot in _slots) {
      if (_valueOf(draft, slot) != null) _locked.add(slot);
    }
    _model.draft.addListener(_tintSky);
    WidgetsBinding.instance.addPostFrameCallback((_) => _tintSky());
  }

  @override
  void dispose() {
    _model.draft.removeListener(_tintSky);
    scheduleMicrotask(() => _model.clearGlow(this));
    _dice.dispose();
    _idea.dispose();
    super.dispose();
  }

  /// Le ciel prend les couleurs de l'univers choisi.
  void _tintSky() {
    if (!mounted) return;
    _model.setGlow(this, _catalogue?.theme(_model.draft.value.theme)?.colors);
  }

  Catalogue? get _catalogue => _model.catalogue.value;

  Future<void> _roll({bool onlyMissing = false}) async {
    if (_catalogue == null || _rolling.isNotEmpty) return;
    final current = _model.draft.value;
    final targets = _slots.where((s) => !_locked.contains(s) && (!onlyMissing || _valueOf(current, s) == null)).toList();
    if (targets.isEmpty) {
      if (!onlyMissing && mounted) showToast(context, 'Tout est verrouillé\u00A0: touche un cadenas pour laisser le dé choisir.', emoji: 'Locked');
      return;
    }
    var kept = current;
    for (final s in targets) {
      kept = _withValue(kept, s, null);
    }
    setState(() => _rolling.addAll(targets));
    _dice.repeat();
    final started = DateTime.now();
    try {
      final drawn = await _model.api.draw(kept);
      final rest = const Duration(milliseconds: 750) - DateTime.now().difference(started);
      if (rest > Duration.zero) await Future<void>.delayed(rest);
      // Les cases s'arrêtent l'une après l'autre, comme une machine à sous.
      for (final (i, slot) in targets.indexed) {
        if (i > 0) await Future<void>.delayed(const Duration(milliseconds: 150));
        if (!mounted) return;
        _model.setDraft(_withValue(_model.draft.value, slot, _valueOf(drawn, slot)));
        setState(() => _rolling.remove(slot));
      }
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.message, emoji: 'Warning');
    } finally {
      if (mounted) {
        setState(_rolling.clear);
        _dice.stop();
        _dice.animateTo(1, duration: const Duration(milliseconds: 260), curve: Curves.easeOut).whenCompleteOrCancel(() {
          if (mounted) _dice.value = 0;
        });
      }
    }
  }

  Future<void> _pick(Slot slot) async {
    final catalogue = _catalogue;
    if (catalogue == null || _rolling.isNotEmpty) return;
    final draft = _model.draft.value;
    final choices = slot == null
        ? [for (final t in catalogue.themes) _Choice(id: t.id, label: t.label, emoji: t.emoji, detail: t.tagline, gradient: t.gradient)]
        : _ingredientChoices(catalogue, slot, draft.theme);
    final picked = await _showPicker(context, title: slot == null ? 'Quel univers\u00A0?' : slot.question, choices: choices, selected: _valueOf(draft, slot));
    if (picked == null || !mounted) return;
    setState(() {
      if (picked.isEmpty) {
        _locked.remove(slot); // « au hasard » : le dé choisira
      } else {
        _locked.add(slot);
      }
    });
    _model.setDraft(_withValue(_model.draft.value, slot, picked.isEmpty ? null : picked));
  }

  List<_Choice> _ingredientChoices(Catalogue catalogue, Kind kind, String? theme) {
    final items = [...catalogue.ingredients[kind]!];
    // D'abord ce qui est fait pour ce thème, puis ce qui va partout, puis le reste.
    int rank(Ingredient i) => i.themes == null ? 1 : (theme != null && i.themes!.contains(theme) ? 0 : 2);
    items.sort((a, b) => rank(a).compareTo(rank(b)));
    return [for (final i in items) _Choice(id: i.id, label: i.label, emoji: i.emoji, detail: i.text, suggested: theme != null && rank(i) == 0)];
  }

  void _toggleLock(Slot slot) => setState(() => _locked.contains(slot) ? _locked.remove(slot) : _locked.add(slot));

  Future<void> _submit() async {
    if (_busy || _rolling.isNotEmpty) return;
    setState(() => _busy = true);
    try {
      _model.setDraft(_model.draft.value.copyWith(idea: _idea.text));
      if (!_model.draft.value.isComplete) await _roll(onlyMissing: true);
      if (!mounted) return;
      if (!_model.draft.value.isComplete) return; // le tirage a échoué : le message est déjà affiché
      await _model.create(_model.draft.value);
      if (!mounted) return;
      final next = await _showLaunched(context);
      if (!mounted) return;
      if (next == 'atelier') {
        context.go('/atelier');
      } else {
        setState(_locked.clear);
        _idea.clear();
        _model.setDraft(Composition(age: _model.draft.value.age, duration: _model.draft.value.duration));
      }
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.message, emoji: 'Warning');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final screen = screenOf(context);
    final insets = MediaQuery.paddingOf(context);
    return ValueListenableBuilder<Catalogue?>(
      valueListenable: _model.catalogue,
      builder: (context, catalogue, _) => ValueListenableBuilder<Composition>(
        valueListenable: _model.draft,
        builder: (context, draft, _) {
          if (catalogue == null) {
            return ValueListenableBuilder<String?>(
              valueListenable: _model.catalogueError,
              builder: (context, error, _) => error == null
                  ? const Center(child: CircularProgressIndicator(color: Palette.accent))
                  : ErrorPanel(message: error, onRetry: _model.loadCatalogue),
            );
          }
          final theme = catalogue.theme(draft.theme);
          final settingsOpen = _settingsOpen ?? screen == ScreenSize.wide;
          final header = _Header(compact: screen == ScreenSize.compact, rolling: _rolling.isNotEmpty, dice: _dice, onRoll: () => _roll());
          final slots = _SlotGrid(
            catalogue: catalogue,
            draft: draft,
            columns: screen == ScreenSize.compact ? 2 : 3,
            locked: _locked,
            rolling: _rolling,
            onPick: _pick,
            onLock: _toggleLock,
          );
          final sentence = _StorySentence(catalogue: catalogue, draft: draft);
          final settings = _ParentSettings(
            catalogue: catalogue,
            draft: draft,
            open: settingsOpen,
            idea: _idea,
            animate: _model.animate,
            onToggle: () => setState(() => _settingsOpen = !settingsOpen),
            onChanged: _model.setDraft,
            onAnimate: _model.setAnimate,
          );
          final launch = _LaunchPanel(busy: _busy, complete: draft.isComplete, theme: theme, onLaunch: _submit);
          final gutter = gutterOf(context);
          return LayoutBuilder(
            builder: (context, box) {
              final side = math.max(gutter, (box.maxWidth - 1240) / 2);
              return SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(side, insets.top + (screen == ScreenSize.compact ? 22 : 10), side, insets.bottom + 40),
                child: screen == ScreenSize.wide
                    ? Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [header, const SizedBox(height: 26), slots, const SizedBox(height: 22), sentence])),
                          const SizedBox(width: 30),
                          SizedBox(width: 380, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [const SizedBox(height: 8), launch, const SizedBox(height: 20), settings])),
                        ],
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [header, const SizedBox(height: 22), slots, const SizedBox(height: 18), sentence, const SizedBox(height: 18), settings, const SizedBox(height: 22), launch],
                      ),
              );
            },
          );
        },
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.compact, required this.rolling, required this.dice, required this.onRoll});

  final bool compact;
  final bool rolling;
  final Animation<double> dice;
  final VoidCallback onRoll;

  @override
  Widget build(BuildContext context) {
    final button = _DiceButton(rolling: rolling, dice: dice, onRoll: onRoll, big: !compact);
    final titles = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Eyebrow('Atelier d’invention', color: Palette.accent),
        const SizedBox(height: 8),
        Text('Invente ton histoire', style: compact ? Txt.h1 : Txt.hero),
        const SizedBox(height: 8),
        Text('Choisis chaque case… ou laisse le dé décider\u00A0!', style: Txt.lead.copyWith(fontSize: compact ? 16 : 18)),
      ],
    );
    if (compact) return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [titles, const SizedBox(height: 18), button]);
    return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [Expanded(child: titles), const SizedBox(width: 20), button]);
  }
}

class _DiceButton extends StatelessWidget {
  const _DiceButton({required this.rolling, required this.dice, required this.onRoll, required this.big});

  final bool rolling;
  final Animation<double> dice;
  final VoidCallback onRoll;
  final bool big;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: rolling ? null : onRoll,
        radius: Radii.pill,
        semanticLabel: 'Lancer le dé',
        hoverScale: 1.04,
        child: Container(
          height: big ? 72 : 64,
          padding: const EdgeInsets.only(left: 10, right: 26),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [Color(0xFF8F7BFF), Color(0xFF5B6CFF)]),
            borderRadius: BorderRadius.circular(Radii.pill),
            boxShadow: [BoxShadow(color: const Color(0xFF6D72FF).withValues(alpha: 0.5), blurRadius: 26, offset: const Offset(0, 10))],
            border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              RotationTransition(turns: dice, child: Emoji('Game die', size: big ? 54 : 48)),
              const SizedBox(width: 10),
              Text(rolling ? 'Ça roule…' : 'Au hasard\u00A0!', style: Txt.button.copyWith(color: Colors.white, fontSize: big ? 21 : 19)),
            ],
          ),
        ),
      );
}

class _SlotGrid extends StatelessWidget {
  const _SlotGrid({required this.catalogue, required this.draft, required this.columns, required this.locked, required this.rolling, required this.onPick, required this.onLock});

  final Catalogue catalogue;
  final Composition draft;
  final int columns;
  final Set<Slot> locked;
  final Set<Slot> rolling;
  final ValueChanged<Slot> onPick;
  final ValueChanged<Slot> onLock;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, box) {
          const gap = 16.0;
          final width = (box.maxWidth - (columns - 1) * gap) / columns;
          final height = columns == 2 ? 196.0 : 214.0;
          final theme = catalogue.theme(draft.theme);
          return Wrap(
            spacing: gap,
            runSpacing: gap,
            children: [
              for (final (i, slot) in _slots.indexed)
                SizedBox(
                  width: width,
                  height: height,
                  child: FadeSlideIn(
                    delay: Duration(milliseconds: 50 * i),
                    child: slot == null
                        ? _SlotCard(
                            title: 'L’univers',
                            emoji: theme?.emoji,
                            name: theme?.label,
                            pool: [for (final t in catalogue.themes) t.emoji],
                            rolling: rolling.contains(slot),
                            locked: locked.contains(slot),
                            gradient: theme?.gradient,
                            onTap: () => onPick(slot),
                            onLock: () => onLock(slot),
                          )
                        : _SlotCard(
                            title: slot.label,
                            emoji: catalogue.ingredient(slot, draft[slot])?.emoji,
                            name: catalogue.ingredient(slot, draft[slot])?.label,
                            pool: [for (final i in catalogue.ingredients[slot]!) i.emoji],
                            rolling: rolling.contains(slot),
                            locked: locked.contains(slot),
                            onTap: () => onPick(slot),
                            onLock: () => onLock(slot),
                          ),
                  ),
                ),
            ],
          );
        },
      );
}

class _SlotCard extends StatefulWidget {
  const _SlotCard({
    required this.title,
    required this.emoji,
    required this.name,
    required this.pool,
    required this.rolling,
    required this.locked,
    required this.onTap,
    required this.onLock,
    this.gradient,
  });

  final String title;
  final String? emoji;
  final String? name;

  /// Les emojis qui défilent pendant le tirage.
  final List<String> pool;
  final bool rolling;
  final bool locked;
  final Gradient? gradient;
  final VoidCallback onTap;
  final VoidCallback onLock;

  @override
  State<_SlotCard> createState() => _SlotCardState();
}

class _SlotCardState extends State<_SlotCard> with SingleTickerProviderStateMixin {
  late final AnimationController _bounce = AnimationController(vsync: this, duration: const Duration(milliseconds: 650), value: 1);
  late final Animation<double> _scale = Tween<double>(begin: 0.55, end: 1).animate(CurvedAnimation(parent: _bounce, curve: Curves.elasticOut));
  final _random = math.Random();
  Timer? _timer;
  String? _flash;

  @override
  void initState() {
    super.initState();
    if (widget.rolling) _startRolling();
  }

  @override
  void didUpdateWidget(_SlotCard old) {
    super.didUpdateWidget(old);
    if (widget.rolling && !old.rolling) _startRolling();
    if (!widget.rolling && old.rolling) {
      _timer?.cancel();
      _flash = null;
      _bounce.forward(from: 0);
    } else if (!widget.rolling && widget.emoji != old.emoji) {
      _bounce.forward(from: 0);
    }
  }

  void _startRolling() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(milliseconds: 80), (_) {
      if (widget.pool.isEmpty) return;
      setState(() => _flash = widget.pool[_random.nextInt(widget.pool.length)]);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _bounce.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filled = widget.emoji != null;
    final shown = widget.rolling ? (_flash ?? widget.emoji) : widget.emoji;
    final themed = widget.gradient != null && filled;
    return Pressable(
      onTap: widget.rolling ? null : widget.onTap,
      semanticLabel: '${widget.title}\u00A0: ${widget.name ?? 'à choisir'}. Touche pour changer.',
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 400),
        curve: Curves.easeOutCubic,
        decoration: BoxDecoration(
          gradient: themed ? widget.gradient : (filled ? const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Palette.surfaceTop, Palette.surface]) : null),
          color: filled ? null : Palette.surface.withValues(alpha: 0.45),
          borderRadius: BorderRadius.circular(Radii.card),
          border: Border.all(color: filled ? Colors.white.withValues(alpha: themed ? 0.3 : 0.12) : Colors.transparent),
          boxShadow: filled ? [BoxShadow(color: (themed ? widget.gradient!.colors.first : Colors.black).withValues(alpha: 0.35), blurRadius: 26, offset: const Offset(0, 12))] : null,
        ),
        child: CustomPaint(
          foregroundPainter: filled ? null : _DashedBorderPainter(radius: Radii.card, color: Palette.lineStrong),
          child: Stack(
            children: [
              Positioned.fill(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 16, 14, 14),
                  child: Column(
                    children: [
                      Eyebrow(widget.title, color: themed ? Colors.white.withValues(alpha: 0.85) : null),
                      const Spacer(),
                      SizedBox(
                        height: 92,
                        child: shown == null
                            ? const _QuestionMark()
                            : ScaleTransition(scale: widget.rolling ? const AlwaysStoppedAnimation(0.92) : _scale, child: Emoji(shown, size: 88)),
                      ),
                      const Spacer(),
                      Text(
                        widget.rolling ? '…' : (widget.name ?? 'Choisir'),
                        maxLines: 2,
                        textAlign: TextAlign.center,
                        overflow: TextOverflow.ellipsis,
                        style: Txt.strong.copyWith(fontSize: 16.5, color: filled ? Palette.text : Palette.textSoft),
                      ),
                    ],
                  ),
                ),
              ),
              if (filled && !widget.rolling)
                Positioned(
                  top: 6,
                  right: 6,
                  child: _LockButton(locked: widget.locked, onTap: widget.onLock),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _QuestionMark extends StatelessWidget {
  const _QuestionMark();

  @override
  Widget build(BuildContext context) => Floating(
        amplitude: 4,
        child: Container(
          width: 76,
          height: 76,
          alignment: Alignment.center,
          decoration: BoxDecoration(shape: BoxShape.circle, color: Palette.accent.withValues(alpha: 0.12), border: Border.all(color: Palette.accent.withValues(alpha: 0.4), width: 2)),
          child: Text('?', style: Txt.hero.copyWith(color: Palette.accent, fontSize: 44, height: 1)),
        ),
      );
}

class _LockButton extends StatelessWidget {
  const _LockButton({required this.locked, required this.onTap});

  final bool locked;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onTap,
        radius: 18,
        tooltip: locked ? 'Gardé\u00A0: le dé n’y touchera pas' : 'Le dé peut changer cette case',
        semanticLabel: locked ? 'Déverrouiller' : 'Verrouiller',
        hoverScale: 1.1,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: locked ? Palette.star : Palette.abyss.withValues(alpha: 0.35),
            border: Border.all(color: locked ? Colors.white.withValues(alpha: 0.6) : Colors.white.withValues(alpha: 0.18)),
          ),
          child: Icon(locked ? Icons.lock_rounded : Icons.lock_open_rounded, size: 18, color: locked ? Palette.accentInk : Palette.text.withValues(alpha: 0.75)),
        ),
      );
}

class _DashedBorderPainter extends CustomPainter {
  _DashedBorderPainter({required this.radius, required this.color});

  final double radius;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()..addRRect(RRect.fromRectAndRadius((Offset.zero & size).deflate(1), Radius.circular(radius)));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    for (final metric in path.computeMetrics()) {
      for (double d = 0; d < metric.length; d += 14) {
        canvas.drawPath(metric.extractPath(d, math.min(d + 8, metric.length)), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBorderPainter old) => old.color != color || old.radius != radius;
}

/// La phrase qui se construit au fil des choix : « Il était une fois… ».
class _StorySentence extends StatelessWidget {
  const _StorySentence({required this.catalogue, required this.draft});

  final Catalogue catalogue;
  final Composition draft;

  @override
  Widget build(BuildContext context) {
    final base = Txt.lead.copyWith(fontFamily: Fonts.display, fontWeight: FontWeight.w600, fontSize: screenOf(context) == ScreenSize.compact ? 19 : 22, height: 1.5);
    TextSpan part(Kind kind, String missing) {
      final ingredient = catalogue.ingredient(kind, draft[kind]);
      return TextSpan(
        text: ingredient?.text ?? missing,
        style: ingredient != null
            ? const TextStyle(color: Palette.accent, fontWeight: FontWeight.w800)
            : const TextStyle(color: Palette.textMute, decoration: TextDecoration.underline, decorationStyle: TextDecorationStyle.dotted, decorationColor: Palette.textMute),
      );
    }

    return Panel(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(children: [Emoji('Open book', size: 28), SizedBox(width: 10), Eyebrow('Ton histoire commence ainsi')]),
          const SizedBox(height: 12),
          AnimatedSize(
            duration: const Duration(milliseconds: 250),
            alignment: Alignment.topLeft,
            child: Text.rich(
              TextSpan(
                style: base,
                children: [
                  const TextSpan(text: 'Il était une fois '),
                  part(Kind.heros, 'un héros mystère'),
                  const TextSpan(text: '. Cap sur '),
                  part(Kind.lieu, 'un endroit secret'),
                  const TextSpan(text: ', avec '),
                  part(Kind.compagnon, 'un fidèle compagnon'),
                  const TextSpan(text: ' et '),
                  part(Kind.objet, 'un objet magique'),
                  const TextSpan(text: '… Et là\u00A0: '),
                  part(Kind.rebondissement, 'une surprise'),
                  const TextSpan(text: '\u00A0!'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ParentSettings extends StatelessWidget {
  const _ParentSettings({
    required this.catalogue,
    required this.draft,
    required this.open,
    required this.idea,
    required this.animate,
    required this.onToggle,
    required this.onChanged,
    required this.onAnimate,
  });

  final Catalogue catalogue;
  final Composition draft;
  final bool open;
  final TextEditingController idea;
  final ValueNotifier<bool> animate;
  final VoidCallback onToggle;
  final ValueChanged<Composition> onChanged;
  final ValueChanged<bool> onAnimate;

  @override
  Widget build(BuildContext context) {
    final abilities = catalogue.abilities;
    return ValueListenableBuilder<bool>(
      valueListenable: animate,
      builder: (context, animated, _) {
        final duration = catalogue.durations.where((d) => d.id == draft.duration).firstOrNull;
        final summary = [
          ageLabel(draft.age),
          if (duration != null) duration.label,
          if (abilities.animation) animated ? 'image animée' : 'image fixe',
          if (draft.idea.trim().isNotEmpty || idea.text.trim().isNotEmpty) 'une idée',
        ].join(' · ');
        return Panel(
          padding: EdgeInsets.zero,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Pressable(
                onTap: onToggle,
                hoverScale: 1.0,
                pressScale: 0.99,
                semanticLabel: open ? 'Replier les réglages des parents' : 'Ouvrir les réglages des parents',
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
                  child: Row(
                    children: [
                      const Emoji('Gear', size: 36),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Pour les parents', style: Txt.strong.copyWith(fontSize: 16.5)),
                            const SizedBox(height: 2),
                            Text(summary, style: Txt.small, maxLines: 1, overflow: TextOverflow.ellipsis),
                          ],
                        ),
                      ),
                      AnimatedRotation(turns: open ? 0.5 : 0, duration: const Duration(milliseconds: 250), child: const Icon(Icons.expand_more_rounded, color: Palette.textSoft)),
                    ],
                  ),
                ),
              ),
              AnimatedSize(
                duration: const Duration(milliseconds: 280),
                curve: Curves.easeOutCubic,
                alignment: Alignment.topCenter,
                child: !open
                    ? const SizedBox(width: double.infinity)
                    : Padding(
                        padding: const EdgeInsets.fromLTRB(18, 0, 18, 20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Divider(color: Palette.line, height: 1),
                            const SizedBox(height: 18),
                            const Eyebrow('Âge de l’auditeur'),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                for (final age in catalogue.ages)
                                  ChoiceChipPill(label: age.label, selected: draft.age == age.id, onTap: () => onChanged(draft.copyWith(age: age.id))),
                              ],
                            ),
                            const SizedBox(height: 18),
                            const Eyebrow('Durée'),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                for (final d in catalogue.durations)
                                  ChoiceChipPill(
                                    label: d.label,
                                    detail: _shortDurations[d.id] ?? d.detail,
                                    selected: draft.duration == d.id,
                                    onTap: () => onChanged(draft.copyWith(duration: d.id)),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 18),
                            const Eyebrow('Une idée à glisser dans l’histoire\u00A0?'),
                            const SizedBox(height: 10),
                            TextField(
                              controller: idea,
                              minLines: 2,
                              maxLines: 4,
                              maxLength: 300,
                              onChanged: (text) => onChanged(draft.copyWith(idea: text)),
                              style: Txt.strong.copyWith(fontWeight: FontWeight.w600),
                              decoration: const InputDecoration(hintText: 'Par exemple\u00A0: le héros a peur du noir, mais il va trouver du courage.'),
                            ),
                            if (abilities.animation) ...[
                              const SizedBox(height: 6),
                              _AnimateSwitch(value: animated, onChanged: onAnimate),
                            ] else if (abilities.image == null) ...[
                              const SizedBox(height: 6),
                              Text('Pas de générateur d’image branché\u00A0: chaque histoire aura le ciel étoilé de son thème.', style: Txt.small),
                            ],
                          ],
                        ),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _AnimateSwitch extends StatelessWidget {
  const _AnimateSwitch({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          const Emoji('Clapper board', size: 34),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Illustration animée', style: Txt.strong),
                Text('Plus magique, mais plus long\u00A0: quelques minutes de plus.', style: Txt.small),
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged),
        ],
      );
}

class _LaunchPanel extends StatelessWidget {
  const _LaunchPanel({required this.busy, required this.complete, required this.theme, required this.onLaunch});

  final bool busy;
  final bool complete;
  final StoryTheme? theme;
  final VoidCallback onLaunch;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GlowButton(label: busy ? 'Un instant…' : 'Raconte-moi cette histoire\u00A0!', emoji: 'Open book', big: true, busy: busy, onPressed: onLaunch),
          const SizedBox(height: 10),
          Text(
            complete ? 'Tout est prêt\u00A0: le conteur n’attend plus que toi.' : 'Les cases vides seront tirées au sort.',
            textAlign: TextAlign.center,
            style: Txt.small,
          ),
        ],
      );
}

class _Choice {
  const _Choice({required this.id, required this.label, required this.emoji, this.detail, this.gradient, this.suggested = false});

  final String id;
  final String label;
  final String emoji;
  final String? detail;
  final Gradient? gradient;
  final bool suggested;
}

/// Le choix d'une case : une grille d'emojis. Renvoie l'identifiant, '' pour « au hasard », null si on ferme.
Future<String?> _showPicker(BuildContext context, {required String title, required List<_Choice> choices, required String? selected}) {
  Widget grid(BuildContext context) => _PickerGrid(title: title, choices: choices, selected: selected);
  if (screenOf(context) == ScreenSize.compact) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.86),
      builder: grid,
    );
  }
  return showDialog<String>(
    context: context,
    builder: (context) => Dialog(
      insetPadding: const EdgeInsets.all(32),
      child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 780, maxHeight: 680), child: grid(context)),
    ),
  );
}

class _PickerGrid extends StatelessWidget {
  const _PickerGrid({required this.title, required this.choices, required this.selected});

  final String title;
  final List<_Choice> choices;
  final String? selected;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(22, 18, 22, 22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: Txt.h2)),
                RoundButton(icon: Icons.close_rounded, tooltip: 'Fermer', size: 42, background: Palette.surfaceTop, onPressed: () => Navigator.of(context).pop()),
              ],
            ),
            const SizedBox(height: 16),
            Flexible(
              child: GridView.builder(
                shrinkWrap: true,
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 150, mainAxisExtent: 160, mainAxisSpacing: 12, crossAxisSpacing: 12),
                itemCount: choices.length + 1,
                itemBuilder: (context, i) {
                  if (i == 0) {
                    return _ChoiceTile(
                      choice: const _Choice(id: '', label: 'Au hasard', emoji: 'Game die', detail: 'Le dé choisira'),
                      selected: selected == null,
                      onTap: () => Navigator.of(context).pop(''),
                    );
                  }
                  final choice = choices[i - 1];
                  return FadeSlideIn(
                    delay: Duration(milliseconds: 15 * math.min(i, 20)),
                    offset: 10,
                    child: _ChoiceTile(choice: choice, selected: choice.id == selected, onTap: () => Navigator.of(context).pop(choice.id)),
                  );
                },
              ),
            ),
          ],
        ),
      );
}

class _ChoiceTile extends StatelessWidget {
  const _ChoiceTile({required this.choice, required this.selected, required this.onTap});

  final _Choice choice;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onTap,
        semanticLabel: choice.label,
        tooltip: choice.detail,
        hoverScale: 1.05,
        child: Container(
          padding: const EdgeInsets.fromLTRB(8, 12, 8, 10),
          decoration: BoxDecoration(
            gradient: choice.gradient,
            color: choice.gradient == null ? (selected ? Palette.surfaceTop : Palette.surfaceHigh) : null,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: selected ? Palette.accent : Palette.line, width: selected ? 2.5 : 1),
          ),
          child: Stack(
            children: [
              Positioned.fill(
                child: Column(
                  children: [
                    Expanded(child: Center(child: Emoji(choice.emoji, size: 72))),
                    const SizedBox(height: 6),
                    Text(choice.label, maxLines: 2, textAlign: TextAlign.center, overflow: TextOverflow.ellipsis, style: Txt.strong.copyWith(fontSize: 14, height: 1.15)),
                  ],
                ),
              ),
              if (choice.suggested)
                const Positioned(top: -2, right: -2, child: Tooltip(message: 'Parfait pour cet univers', child: Emoji('Glowing star', size: 26))),
            ],
          ),
        ),
      );
}

/// Après l'envoi : une petite fête, puis l'atelier ou une nouvelle histoire.
Future<String?> _showLaunched(BuildContext context) => showDialog<String>(
      context: context,
      builder: (context) => Dialog(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(28, 30, 28, 26),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Floating(child: Emoji('Party popper', size: 104)),
                const SizedBox(height: 14),
                Text('C’est parti\u00A0!', style: Txt.h1, textAlign: TextAlign.center),
                const SizedBox(height: 10),
                Text(
                  'Ton histoire se prépare dans l’atelier\u00A0: le texte, la voix du conteur, l’illustration… Ça prend quelques minutes, et tout se fait sur ce PC.',
                  textAlign: TextAlign.center,
                  style: Txt.body,
                ),
                const SizedBox(height: 24),
                GlowButton(label: 'Suivre sa fabrication', emoji: 'Hourglass not done', onPressed: () => Navigator.of(context).pop('atelier')),
                const SizedBox(height: 12),
                SoftButton(label: 'Inventer une autre histoire', emoji: 'Sparkles', onPressed: () => Navigator.of(context).pop('nouvelle')),
              ],
            ),
          ),
        ),
      ),
    );
