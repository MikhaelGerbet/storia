// Le ciel de nuit derrière chaque écran : un dégradé profond, deux halos colorés et des étoiles qui scintillent.
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'theme.dart';

class NightBackdrop extends StatefulWidget {
  const NightBackdrop({super.key, this.glow = const [Color(0xFF3B4FA8), Color(0xFF7A3E8C)], required this.child});

  /// Les couleurs des halos : celles du thème choisi, par exemple.
  final List<Color> glow;
  final Widget child;

  @override
  State<NightBackdrop> createState() => _NightBackdropState();
}

class _NightBackdropState extends State<NightBackdrop> with SingleTickerProviderStateMixin {
  late final AnimationController _twinkle = AnimationController(vsync: this, duration: const Duration(seconds: 7))..repeat();
  late final List<_Star> _stars = _makeStars();

  static List<_Star> _makeStars() {
    final random = math.Random(7);
    return List.generate(110, (_) {
      final big = random.nextDouble() < 0.12;
      return _Star(
        x: random.nextDouble(),
        y: math.pow(random.nextDouble(), 1.35).toDouble(), // plus d'étoiles en haut du ciel
        radius: big ? 1.3 + random.nextDouble() * 0.9 : 0.5 + random.nextDouble() * 0.7,
        phase: random.nextDouble(),
        speed: 0.6 + random.nextDouble() * 1.4,
        warm: random.nextDouble() < 0.18,
      );
    });
  }

  @override
  void dispose() {
    _twinkle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduce) _twinkle.stop();
    return Stack(
      fit: StackFit.expand,
      children: [
        RepaintBoundary(
          child: TweenAnimationBuilder<Color?>(
            tween: ColorTween(end: widget.glow.first),
            duration: const Duration(milliseconds: 900),
            builder: (context, first, _) => TweenAnimationBuilder<Color?>(
              tween: ColorTween(end: widget.glow.last),
              duration: const Duration(milliseconds: 900),
              builder: (context, second, _) => CustomPaint(
                painter: _SkyPainter(glowA: first ?? widget.glow.first, glowB: second ?? widget.glow.last),
              ),
            ),
          ),
        ),
        RepaintBoundary(child: CustomPaint(painter: _StarsPainter(_stars, _twinkle))),
        widget.child,
      ],
    );
  }
}

class _Star {
  const _Star({required this.x, required this.y, required this.radius, required this.phase, required this.speed, required this.warm});

  final double x;
  final double y;
  final double radius;
  final double phase;
  final double speed;
  final bool warm;
}

class _SkyPainter extends CustomPainter {
  _SkyPainter({required this.glowA, required this.glowB});

  final Color glowA;
  final Color glowB;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(
      rect,
      Paint()..shader = const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF0D1633), Palette.abyss, Color(0xFF05070F)], stops: [0, 0.55, 1]).createShader(rect),
    );
    void halo(Offset center, double radius, Color color, double alpha) {
      canvas.drawCircle(
        center,
        radius,
        Paint()..shader = RadialGradient(colors: [color.withValues(alpha: alpha), color.withValues(alpha: 0)]).createShader(Rect.fromCircle(center: center, radius: radius)),
      );
    }

    final r = math.max(size.width, size.height);
    halo(Offset(size.width * 0.12, size.height * 0.02), r * 0.55, glowA, 0.30);
    halo(Offset(size.width * 0.95, size.height * 0.30), r * 0.45, glowB, 0.22);
    halo(Offset(size.width * 0.5, size.height * 1.05), r * 0.5, const Color(0xFF1B2A5C), 0.35);
  }

  @override
  bool shouldRepaint(_SkyPainter old) => old.glowA != glowA || old.glowB != glowB;
}

class _StarsPainter extends CustomPainter {
  _StarsPainter(this.stars, this.time) : super(repaint: time);

  final List<_Star> stars;
  final Animation<double> time;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    for (final s in stars) {
      final wave = 0.5 + 0.5 * math.sin((time.value * s.speed + s.phase) * 2 * math.pi);
      final alpha = 0.25 + 0.75 * wave;
      final center = Offset(s.x * size.width, s.y * size.height * 0.9);
      final color = s.warm ? Palette.star : const Color(0xFFDDE7FF);
      paint.color = color.withValues(alpha: alpha * (s.radius > 1.2 ? 0.95 : 0.7));
      canvas.drawCircle(center, s.radius, paint);
      if (s.radius > 1.2) {
        // Les plus grosses ont un petit halo.
        paint.color = color.withValues(alpha: 0.12 * alpha);
        canvas.drawCircle(center, s.radius * 4, paint);
      }
    }
  }

  @override
  bool shouldRepaint(_StarsPainter old) => false;
}
