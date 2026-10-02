// Les briques de l'interface : emoji 3D, surfaces qui réagissent au toucher, boutons, pastilles, états vides.
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// Un emoji 3D de Microsoft Fluent (licence MIT), rangé dans assets/emoji sous son nom en minuscules.
class Emoji extends StatelessWidget {
  const Emoji(this.name, {super.key, this.size = 40, this.semanticLabel});

  final String name;
  final double size;
  final String? semanticLabel;

  static String assetOf(String name) => 'assets/emoji/${name.toLowerCase().replaceAll(RegExp(r'[ -]'), '_')}.png';

  @override
  Widget build(BuildContext context) => Image.asset(
        assetOf(name),
        width: size,
        height: size,
        filterQuality: FilterQuality.medium,
        semanticLabel: semanticLabel,
        excludeFromSemantics: semanticLabel == null,
        gaplessPlayback: true,
        errorBuilder: (context, error, stack) => SizedBox.square(
          dimension: size,
          child: DecoratedBox(decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: 0.08))),
        ),
      );
}

/// Une surface qui grossit un peu au survol, s'enfonce quand on appuie, et se pilote au clavier.
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.onTap, required this.child, this.semanticLabel, this.radius = Radii.card, this.hoverScale = 1.02, this.pressScale = 0.96, this.tooltip});

  final VoidCallback? onTap;
  final Widget child;
  final String? semanticLabel;
  final String? tooltip;
  final double radius;
  final double hoverScale;
  final double pressScale;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _hover = false;
  bool _down = false;
  bool _focus = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    final scale = !enabled ? 1.0 : (_down ? widget.pressScale : (_hover ? widget.hoverScale : 1.0));
    Widget child = FocusableActionDetector(
      enabled: enabled,
      mouseCursor: enabled ? SystemMouseCursors.click : MouseCursor.defer,
      onShowHoverHighlight: (value) => setState(() => _hover = value),
      onShowFocusHighlight: (value) => setState(() => _focus = value),
      actions: {
        ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
          widget.onTap?.call();
          return null;
        }),
      },
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTapCancel: enabled ? () => setState(() => _down = false) : null,
        onTap: enabled
            ? () {
                HapticFeedback.selectionClick();
                widget.onTap!();
              }
            : null,
        child: AnimatedScale(
          scale: scale,
          duration: Duration(milliseconds: _down ? 90 : 220),
          curve: _down ? Curves.easeOut : Curves.easeOutBack,
          child: Stack(
            children: [
              widget.child,
              Positioned.fill(
                child: IgnorePointer(
                  child: AnimatedOpacity(
                    opacity: _focus ? 1 : 0,
                    duration: const Duration(milliseconds: 150),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(widget.radius),
                        border: Border.all(color: Palette.accent, width: 3),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (widget.tooltip != null) child = Tooltip(message: widget.tooltip!, child: child);
    return Semantics(button: true, enabled: enabled, label: widget.semanticLabel, child: child);
  }
}

/// Le bouton principal : une pilule lumineuse couleur lanterne.
class GlowButton extends StatelessWidget {
  const GlowButton({super.key, required this.label, required this.onPressed, this.emoji, this.icon, this.busy = false, this.big = false, this.gradient});

  final String label;
  final VoidCallback? onPressed;
  final String? emoji;
  final IconData? icon;
  final bool busy;
  final bool big;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    final height = big ? 66.0 : 54.0;
    return Opacity(
      opacity: enabled || busy ? 1 : 0.5,
      child: Pressable(
        onTap: enabled ? onPressed : null,
        radius: Radii.pill,
        semanticLabel: label,
        child: Container(
          height: height,
          padding: EdgeInsets.symmetric(horizontal: big ? 30 : 24),
          decoration: BoxDecoration(
            gradient: gradient ?? Palette.accentGradient,
            borderRadius: BorderRadius.circular(Radii.pill),
            boxShadow: [
              BoxShadow(color: Palette.accentHot.withValues(alpha: enabled ? 0.45 : 0.15), blurRadius: big ? 34 : 22, offset: const Offset(0, 10)),
              BoxShadow(color: Colors.white.withValues(alpha: 0.25), blurRadius: 0, spreadRadius: -1, offset: const Offset(0, -1)),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (busy)
                const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 3, color: Palette.accentInk))
              else if (emoji != null)
                Emoji(emoji!, size: big ? 34 : 28)
              else if (icon != null)
                Icon(icon, color: Palette.accentInk, size: big ? 28 : 24),
              if (busy || emoji != null || icon != null) SizedBox(width: big ? 12 : 10),
              Flexible(
                child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: Txt.button.copyWith(color: Palette.accentInk, fontSize: big ? 20 : 17)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Le bouton secondaire : une pilule sombre bordée.
class SoftButton extends StatelessWidget {
  const SoftButton({super.key, required this.label, required this.onPressed, this.emoji, this.icon, this.color, this.compact = false});

  final String label;
  final VoidCallback? onPressed;
  final String? emoji;
  final IconData? icon;
  final Color? color;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final tint = color ?? Palette.text;
    return Opacity(
      opacity: onPressed == null ? 0.45 : 1,
      child: Pressable(
        onTap: onPressed,
        radius: Radii.pill,
        semanticLabel: label,
        child: Container(
          height: compact ? 42 : 50,
          padding: EdgeInsets.symmetric(horizontal: compact ? 16 : 20),
          decoration: BoxDecoration(
            color: Palette.surfaceHigh.withValues(alpha: 0.9),
            borderRadius: BorderRadius.circular(Radii.pill),
            border: Border.all(color: color?.withValues(alpha: 0.45) ?? Palette.lineStrong),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (emoji != null) ...[Emoji(emoji!, size: compact ? 20 : 24), const SizedBox(width: 8)],
              if (icon != null) ...[Icon(icon, size: compact ? 18 : 20, color: tint), const SizedBox(width: 8)],
              Text(label, style: Txt.button.copyWith(fontSize: compact ? 14.5 : 16, color: tint)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Un bouton rond, pour les icônes posées sur une image (retour, fermer, favori).
class RoundButton extends StatelessWidget {
  const RoundButton({super.key, required this.icon, required this.onPressed, required this.tooltip, this.color, this.size = 48, this.background});

  final IconData icon;
  final VoidCallback? onPressed;
  final String tooltip;
  final Color? color;
  final Color? background;
  final double size;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onPressed,
        radius: size / 2,
        tooltip: tooltip,
        semanticLabel: tooltip,
        hoverScale: 1.08,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: background ?? Palette.abyss.withValues(alpha: 0.55),
            border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
          ),
          child: Icon(icon, color: color ?? Palette.text, size: size * 0.46),
        ),
      );
}

/// Une pastille sélectionnable : un thème, un tri, une tranche d'âge.
class ChoiceChipPill extends StatelessWidget {
  const ChoiceChipPill({super.key, required this.label, required this.selected, required this.onTap, this.emoji, this.gradient, this.detail});

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final String? emoji;
  final Gradient? gradient;
  final String? detail;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onTap,
        radius: Radii.pill,
        semanticLabel: label,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
          height: 46,
          padding: EdgeInsets.only(left: emoji != null ? 8 : 18, right: 18),
          decoration: BoxDecoration(
            gradient: selected ? (gradient ?? Palette.accentGradient) : null,
            color: selected ? null : Palette.surfaceHigh.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(Radii.pill),
            border: Border.all(color: selected ? Colors.white.withValues(alpha: 0.35) : Palette.line),
            boxShadow: selected ? [BoxShadow(color: (gradient?.colors.first ?? Palette.accent).withValues(alpha: 0.35), blurRadius: 18, offset: const Offset(0, 6))] : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (emoji != null) ...[Emoji(emoji!, size: 30), const SizedBox(width: 8)],
              Text(
                label,
                style: Txt.strong.copyWith(color: selected ? (gradient == null ? Palette.accentInk : Colors.white) : Palette.text, fontSize: 15),
              ),
              if (detail != null) ...[
                const SizedBox(width: 6),
                Text(detail!, style: Txt.small.copyWith(color: selected ? (gradient == null ? Palette.accentInk.withValues(alpha: 0.7) : Colors.white70) : Palette.textMute)),
              ],
            ],
          ),
        ),
      );
}

/// Une petite information : « 3 min », « 12 écoutes ».
class MetaPill extends StatelessWidget {
  const MetaPill({super.key, required this.text, this.emoji, this.icon, this.background, this.color});

  final String text;
  final String? emoji;
  final IconData? icon;
  final Color? background;
  final Color? color;

  @override
  Widget build(BuildContext context) => Container(
        height: 30,
        padding: EdgeInsets.only(left: emoji != null || icon != null ? 6 : 12, right: 12),
        decoration: BoxDecoration(color: background ?? Colors.white.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(Radii.pill)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (emoji != null) ...[Emoji(emoji!, size: 20), const SizedBox(width: 5)],
            if (icon != null) ...[Icon(icon, size: 16, color: color ?? Palette.textSoft), const SizedBox(width: 5)],
            Text(text, style: Txt.small.copyWith(color: color ?? Palette.textSoft, fontWeight: FontWeight.w800)),
          ],
        ),
      );
}

/// Une carte sombre et douce, bordée d'un filet de lumière.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(22), this.color, this.gradient, this.borderColor, this.radius = Radii.card});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;
  final Gradient? gradient;
  final Color? borderColor;
  final double radius;

  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(
          color: gradient == null ? (color ?? Palette.surface.withValues(alpha: 0.82)) : null,
          gradient: gradient,
          borderRadius: BorderRadius.circular(radius),
          border: Border.all(color: borderColor ?? Palette.line),
          boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 30, offset: Offset(0, 14))],
        ),
        child: child,
      );
}

/// Un petit titre en capitales au-dessus d'une section.
class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key, this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) => Text(text.toUpperCase(), style: Txt.label.copyWith(color: color));
}

/// Apparition en fondu, légèrement remontée, avec un délai pour les listes en cascade.
class FadeSlideIn extends StatefulWidget {
  const FadeSlideIn({super.key, required this.child, this.delay = Duration.zero, this.offset = 18});

  final Widget child;
  final Duration delay;
  final double offset;

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 520));
  late final Animation<double> _curve = CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic);

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(widget.delay, () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _curve,
        builder: (context, child) => Opacity(
          opacity: _curve.value,
          child: Transform.translate(offset: Offset(0, widget.offset * (1 - _curve.value)), child: child),
        ),
        child: widget.child,
      );
}

/// Un emoji qui flotte doucement, pour donner vie aux écrans calmes.
class Floating extends StatefulWidget {
  const Floating({super.key, required this.child, this.amplitude = 6, this.period = const Duration(milliseconds: 3200), this.phase = 0});

  final Widget child;
  final double amplitude;
  final Duration period;
  final double phase;

  @override
  State<Floating> createState() => _FloatingState();
}

class _FloatingState extends State<Floating> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: widget.period)..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) return widget.child;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = (_controller.value + widget.phase) * 2 * math.pi;
        return Transform.translate(offset: Offset(0, math.sin(t) * widget.amplitude), child: Transform.rotate(angle: math.sin(t + 1) * 0.04, child: child));
      },
      child: widget.child,
    );
  }
}

/// Une barre d'avancement dorée, arrondie, avec un reflet qui glisse.
class GlowProgressBar extends StatelessWidget {
  const GlowProgressBar({super.key, required this.value, this.height = 12, this.gradient});

  final double value;
  final double height;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(height),
        child: Container(
          height: height,
          color: Colors.white.withValues(alpha: 0.08),
          alignment: Alignment.centerLeft,
          child: TweenAnimationBuilder<double>(
            tween: Tween(end: value.clamp(0, 1)),
            duration: const Duration(milliseconds: 700),
            curve: Curves.easeOutCubic,
            builder: (context, v, _) => FractionallySizedBox(
              widthFactor: math.max(v, 0.02),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: gradient ?? Palette.accentGradient,
                  borderRadius: BorderRadius.circular(height),
                  boxShadow: [BoxShadow(color: Palette.accent.withValues(alpha: 0.6), blurRadius: 12)],
                ),
              ),
            ),
          ),
        ),
      );
}

/// Un anneau d'avancement, pour les petites pastilles.
class ProgressRing extends StatelessWidget {
  const ProgressRing({super.key, required this.value, this.size = 44, this.stroke = 5, this.child});

  final double value;
  final double size;
  final double stroke;
  final Widget? child;

  @override
  Widget build(BuildContext context) => SizedBox.square(
        dimension: size,
        child: TweenAnimationBuilder<double>(
          tween: Tween(end: value.clamp(0, 1)),
          duration: const Duration(milliseconds: 700),
          curve: Curves.easeOutCubic,
          builder: (context, v, child) => CustomPaint(painter: _RingPainter(v, stroke), child: Center(child: child)),
          child: child,
        ),
      );
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.value, this.stroke);

  final double value;
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = (Offset.zero & size).deflate(stroke / 2);
    canvas.drawArc(rect, 0, 2 * math.pi, false, Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = Colors.white.withValues(alpha: 0.12));
    canvas.drawArc(rect, -math.pi / 2, 2 * math.pi * value, false, Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..shader = const SweepGradient(colors: [Palette.accent, Palette.star, Palette.accent]).createShader(rect));
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.value != value;
}

/// Un écran vide qui donne envie : un emoji, une phrase, une action.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.emoji, required this.title, required this.text, this.action, this.secondEmoji});

  final String emoji;
  final String? secondEmoji;
  final String title;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                height: 150,
                width: 220,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      width: 150,
                      height: 150,
                      decoration: BoxDecoration(shape: BoxShape.circle, gradient: RadialGradient(colors: [Palette.accent.withValues(alpha: 0.25), Palette.accent.withValues(alpha: 0)])),
                    ),
                    Floating(child: Emoji(emoji, size: 112)),
                    if (secondEmoji != null) Positioned(right: 18, top: 6, child: Floating(phase: 0.4, amplitude: 4, child: Emoji(secondEmoji!, size: 46))),
                    const Positioned(left: 22, bottom: 14, child: Floating(phase: 0.7, amplitude: 5, child: Emoji('Sparkles', size: 38))),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Text(title, textAlign: TextAlign.center, style: Txt.h2),
              const SizedBox(height: 10),
              Text(text, textAlign: TextAlign.center, style: Txt.body),
              if (action != null) ...[const SizedBox(height: 24), action!],
            ],
          ),
        ),
      );
}

/// Un rectangle qui pulse doucement, à la place d'un contenu qui arrive.
class Shimmer extends StatefulWidget {
  const Shimmer({super.key, this.radius = Radii.card, this.height, this.width});

  final double radius;
  final double? height;
  final double? width;

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300))..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
        opacity: Tween(begin: 0.45, end: 0.9).animate(_controller),
        child: Container(
          height: widget.height,
          width: widget.width,
          decoration: BoxDecoration(color: Palette.surfaceHigh, borderRadius: BorderRadius.circular(widget.radius)),
        ),
      );
}

/// Un message d'erreur avec de quoi réessayer.
class ErrorPanel extends StatelessWidget {
  const ErrorPanel({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => EmptyState(
        emoji: 'Thinking face',
        title: 'Oups, petit souci',
        text: message,
        action: onRetry == null ? null : SoftButton(label: 'Réessayer', icon: Icons.refresh_rounded, onPressed: onRetry),
      );
}

/// Montre un petit message en bas de l'écran, à la façon de Storia.
void showToast(BuildContext context, String message, {String? emoji, String? actionLabel, VoidCallback? onAction}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger != null) showToastOn(messenger, message, emoji: emoji, actionLabel: actionLabel, onAction: onAction);
}

void showToastOn(ScaffoldMessengerState messenger, String message, {String? emoji, String? actionLabel, VoidCallback? onAction}) {
  final media = MediaQuery.of(messenger.context);
  // Sur téléphone, au-dessus de la barre de navigation ; ailleurs, une bulle centrée.
  final compact = media.size.width < 640;
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      width: compact ? null : 520,
      margin: compact ? EdgeInsets.fromLTRB(14, 0, 14, media.padding.bottom + 100) : null,
      content: Row(
        children: [
          if (emoji != null) ...[Emoji(emoji, size: 30), const SizedBox(width: 12)],
          Expanded(child: Text(message, style: Txt.strong)),
        ],
      ),
      action: actionLabel == null ? null : SnackBarAction(label: actionLabel, onPressed: onAction ?? () {}),
      duration: const Duration(seconds: 5),
    ),
  );
}

/// Une petite boîte de dialogue de confirmation, avec un emoji.
Future<bool> confirm(BuildContext context, {required String title, required String text, required String yes, String emoji = 'Thinking face', bool danger = false}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      icon: Emoji(emoji, size: 64),
      title: Text(title, textAlign: TextAlign.center),
      content: Text(text, textAlign: TextAlign.center),
      actionsAlignment: MainAxisAlignment.center,
      actionsPadding: const EdgeInsets.fromLTRB(20, 4, 20, 22),
      actions: [
        SoftButton(label: 'Non, garder', compact: true, onPressed: () => Navigator.of(context).pop(false)),
        SoftButton(label: yes, compact: true, color: danger ? Palette.rose : Palette.accent, onPressed: () => Navigator.of(context).pop(true)),
      ],
    ),
  );
  return result ?? false;
}
