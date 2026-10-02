// Ce qui représente une histoire à l'écran : sa couverture, sa carte dans la bibliothèque, sa petite constellation d'emojis.
import 'package:flutter/material.dart';

import '../data/api.dart';
import '../data/models.dart';
import 'theme.dart';
import 'widgets.dart';

/// Une illustration de secours : le dégradé du thème, quelques étoiles, et le héros en grand.
class ThemeArt extends StatelessWidget {
  const ThemeArt({super.key, required this.colors, required this.emoji, this.secondEmoji, this.emojiScale = 0.5});

  final List<Color> colors;
  final String emoji;
  final String? secondEmoji;
  final double emojiScale;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, box) {
          final side = box.biggest.shortestSide.isFinite ? box.biggest.shortestSide : 200.0;
          return DecoratedBox(
            decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: colors)),
            child: Stack(
              fit: StackFit.expand,
              children: [
                CustomPaint(painter: _SparklesPainter(seed: emoji.hashCode)),
                DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: RadialGradient(center: const Alignment(0, 0.1), radius: 0.75, colors: [Colors.white.withValues(alpha: 0.22), Colors.white.withValues(alpha: 0)]),
                  ),
                ),
                Center(child: Emoji(emoji, size: side * emojiScale)),
                // En bas à droite : le haut de la carte porte déjà le cœur des favoris.
                if (secondEmoji != null)
                  Positioned(right: side * 0.07, bottom: side * 0.07, child: Opacity(opacity: 0.9, child: Emoji(secondEmoji!, size: side * 0.2))),
              ],
            ),
          );
        },
      );
}

class _SparklesPainter extends CustomPainter {
  _SparklesPainter({required this.seed});

  final int seed;

  @override
  void paint(Canvas canvas, Size size) {
    var x = seed & 0x7fffffff;
    double next() {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x / 0x7fffffff;
    }

    final paint = Paint();
    for (var i = 0; i < 26; i++) {
      final r = 0.6 + next() * 1.6;
      paint.color = Colors.white.withValues(alpha: 0.18 + next() * 0.4);
      canvas.drawCircle(Offset(next() * size.width, next() * size.height), r, paint);
    }
  }

  @override
  bool shouldRepaint(_SparklesPainter old) => old.seed != seed;
}

/// La couverture d'une histoire : son illustration si elle en a une, sinon l'illustration de secours de son thème.
class StoryCover extends StatelessWidget {
  const StoryCover({super.key, required this.story, required this.catalogue, required this.api, this.emojiScale = 0.5, this.themeBadge = true});

  final Story story;
  final Catalogue? catalogue;
  final StoriaApi api;
  final double emojiScale;

  /// Le petit emoji du thème dans un coin de l'illustration de secours.
  final bool themeBadge;

  @override
  Widget build(BuildContext context) {
    final theme = catalogue?.theme(story.theme);
    final hero = catalogue?.ingredient(Kind.heros, story.composition?[Kind.heros]);
    final fallback = ThemeArt(
      colors: theme?.colors ?? const [Palette.surfaceTop, Palette.night],
      emoji: hero?.emoji ?? theme?.emoji ?? 'Open book',
      secondEmoji: hero != null && themeBadge ? theme?.emoji : null,
      emojiScale: emojiScale,
    );
    final cover = story.cover;
    if (cover == null) return fallback;
    return Image.network(
      api.url(cover),
      fit: BoxFit.cover,
      filterQuality: FilterQuality.medium,
      errorBuilder: (context, error, stack) => fallback,
      frameBuilder: (context, child, frame, synchronous) => synchronous
          ? child
          : Stack(
              fit: StackFit.expand,
              children: [
                fallback,
                AnimatedOpacity(opacity: frame == null ? 0 : 1, duration: const Duration(milliseconds: 400), child: child),
              ],
            ),
    );
  }
}

/// Une histoire dans la bibliothèque.
class StoryCard extends StatelessWidget {
  const StoryCard({super.key, required this.story, required this.catalogue, required this.api, required this.onOpen, required this.onFavorite});

  final Story story;
  final Catalogue? catalogue;
  final StoriaApi api;
  final VoidCallback onOpen;
  final VoidCallback onFavorite;

  /// Hauteur de la partie texte, sous la couverture.
  static const textHeight = 148.0;

  @override
  Widget build(BuildContext context) {
    final theme = catalogue?.theme(story.theme);
    final fresh = story.reads == 0 && DateTime.now().difference(story.createdAt).inHours < 48;
    return Pressable(
      onTap: onOpen,
      semanticLabel: 'Ouvrir «\u00A0${story.title}\u00A0»',
      child: Container(
        decoration: BoxDecoration(
          color: Palette.surface.withValues(alpha: 0.9),
          borderRadius: BorderRadius.circular(Radii.card),
          border: Border.all(color: Palette.line),
          boxShadow: [
            BoxShadow(color: (theme?.colors.first ?? Colors.black).withValues(alpha: 0.18), blurRadius: 30, offset: const Offset(0, 16)),
            const BoxShadow(color: Color(0x55000000), blurRadius: 12, offset: Offset(0, 6)),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  StoryCover(story: story, catalogue: catalogue, api: api),
                  const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00000000), Color(0x00000000), Color(0x99060A14)], stops: [0, 0.6, 1]),
                    ),
                  ),
                  Positioned(left: 12, bottom: 12, child: MetaPill(text: story.durationLabel, icon: Icons.schedule_rounded, background: Palette.abyss.withValues(alpha: 0.6), color: Palette.text)),
                  if (fresh)
                    Positioned(
                      left: 12,
                      top: 12,
                      child: MetaPill(text: 'Nouvelle', emoji: 'Sparkles', background: Palette.accent, color: Palette.accentInk),
                    ),
                  Positioned(
                    right: 10,
                    top: 10,
                    child: RoundButton(
                      icon: story.favorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                      color: story.favorite ? Palette.rose : Palette.text,
                      tooltip: story.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris',
                      size: 42,
                      onPressed: onFavorite,
                    ),
                  ),
                ],
              ),
            ),
            SizedBox(
              height: textHeight,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(story.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: Txt.h3.copyWith(fontSize: 19)),
                    const SizedBox(height: 6),
                    Text(story.teaser, maxLines: 2, overflow: TextOverflow.ellipsis, style: Txt.body.copyWith(fontSize: 14, height: 1.35)),
                    const Spacer(),
                    Row(
                      children: [
                        if (theme != null) ...[
                          Emoji(theme.emoji, size: 22),
                          const SizedBox(width: 6),
                          Flexible(child: Text(theme.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: Txt.small.copyWith(color: Palette.textSoft))),
                        ] else
                          const Spacer(),
                        const SizedBox(width: 12),
                        const Emoji('Headphone', size: 20),
                        const SizedBox(width: 5),
                        Text('${story.reads}', style: Txt.small.copyWith(color: Palette.textSoft)),
                        const SizedBox(width: 12),
                        Text(ageLabel(story.age), style: Txt.small),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Le héros entouré de son compagnon et de son objet, sur le dégradé du thème.
class CompositionArt extends StatelessWidget {
  const CompositionArt({super.key, required this.composition, required this.catalogue, this.size = 120, this.animated = false});

  final Composition composition;
  final Catalogue? catalogue;
  final double size;
  final bool animated;

  @override
  Widget build(BuildContext context) {
    final theme = catalogue?.theme(composition.theme);
    final hero = catalogue?.ingredient(Kind.heros, composition[Kind.heros]);
    final friend = catalogue?.ingredient(Kind.compagnon, composition[Kind.compagnon]);
    final thing = catalogue?.ingredient(Kind.objet, composition[Kind.objet]);
    Widget main = Emoji(hero?.emoji ?? theme?.emoji ?? 'Sparkles', size: size * 0.56);
    if (animated) main = Floating(amplitude: size * 0.03, child: main);
    return SizedBox.square(
      dimension: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: theme?.gradient ?? Palette.accentGradient,
              boxShadow: [BoxShadow(color: (theme?.colors.first ?? Palette.accent).withValues(alpha: 0.45), blurRadius: size * 0.3)],
              border: Border.all(color: Colors.white.withValues(alpha: 0.25), width: 2),
            ),
          ),
          Center(child: main),
          if (friend != null) Positioned(left: -size * 0.04, bottom: -size * 0.02, child: Emoji(friend.emoji, size: size * 0.3)),
          if (thing != null) Positioned(right: -size * 0.04, top: -size * 0.02, child: Emoji(thing.emoji, size: size * 0.28)),
        ],
      ),
    );
  }
}
