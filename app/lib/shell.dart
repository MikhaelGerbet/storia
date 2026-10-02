// Le cadre commun aux trois onglets : le logo, la navigation (en haut sur grand écran, en bas sur téléphone).
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'app_scope.dart';
import 'data/models.dart';
import 'ui/theme.dart';
import 'ui/widgets.dart';

class _Tab {
  const _Tab(this.path, this.label, this.emoji);

  final String path;
  final String label;
  final String emoji;
}

const _tabs = [
  _Tab('/', 'Bibliothèque', 'Books'),
  _Tab('/creer', 'Créer', 'Magic wand'),
  _Tab('/atelier', 'Atelier', 'Hourglass not done'),
];

/// Hauteur réservée à la navigation, que les écrans ajoutent à leurs marges.
const navReserve = 104.0;

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.location, required this.child});

  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final compact = screenOf(context) == ScreenSize.compact;
    final media = MediaQuery.of(context);
    // Les écrans reçoivent la place prise par la navigation comme une marge de sécurité.
    final padded = media.copyWith(
      padding: media.padding.copyWith(top: media.padding.top + (compact ? 0 : navReserve), bottom: media.padding.bottom + (compact ? navReserve : 0)),
    );
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Stack(
        children: [
          MediaQuery(data: padded, child: child),
          if (compact)
            Positioned(left: 12, right: 12, bottom: media.padding.bottom + 14, child: Center(child: _NavBar(location: location, compact: true)))
          else
            Positioned(left: 0, right: 0, top: media.padding.top, child: _TopBar(location: location)),
        ],
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.location});

  final String location;

  @override
  Widget build(BuildContext context) {
    final gutter = gutterOf(context);
    return Container(
      height: navReserve - 8,
      padding: EdgeInsets.symmetric(horizontal: gutter),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1240),
          child: Row(
            children: [
              const Logo(),
              const Spacer(),
              _NavBar(location: location, compact: false),
            ],
          ),
        ),
      ),
    );
  }
}

/// Le nom de l'application, avec sa lune.
class Logo extends StatelessWidget {
  const Logo({super.key, this.size = 30});

  final double size;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: () => context.go('/'),
        radius: 18,
        semanticLabel: 'Storia, retour à la bibliothèque',
        hoverScale: 1.03,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Floating(amplitude: 2.5, child: Emoji('Crescent moon', size: size * 1.35)),
              const SizedBox(width: 8),
              Text('Storia', style: Txt.h2.copyWith(fontSize: size, fontWeight: FontWeight.w900, letterSpacing: -0.4)),
            ],
          ),
        ),
      );
}

class _NavBar extends StatelessWidget {
  const _NavBar({required this.location, required this.compact});

  final String location;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final model = AppScope.of(context);
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Palette.night.withValues(alpha: 0.86),
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: Palette.lineStrong),
        boxShadow: const [BoxShadow(color: Color(0x99000000), blurRadius: 30, offset: Offset(0, 12))],
      ),
      child: ValueListenableBuilder<List<Creation>>(
        valueListenable: model.creations,
        builder: (context, creations, _) {
          final pending = creations.where((c) => c.state.isPending).toList();
          final running = pending.where((c) => c.state == CreationState.running).firstOrNull;
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final tab in _tabs)
                _NavItem(
                  tab: tab,
                  selected: tab.path == '/' ? location == '/' : location.startsWith(tab.path),
                  compact: compact,
                  badge: tab.path == '/atelier' && pending.isNotEmpty ? pending.length : null,
                  progress: tab.path == '/atelier' ? running?.progress?.overall : null,
                ),
            ],
          );
        },
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.tab, required this.selected, required this.compact, this.badge, this.progress});

  final _Tab tab;
  final bool selected;
  final bool compact;
  final int? badge;
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final create = tab.path == '/creer';
    Widget icon = Emoji(tab.emoji, size: compact ? 30 : 28);
    if (progress != null) icon = ProgressRing(value: progress!, size: compact ? 40 : 38, stroke: 3.5, child: Emoji(tab.emoji, size: compact ? 24 : 22));
    return Pressable(
      onTap: () => context.go(tab.path),
      radius: Radii.pill,
      semanticLabel: tab.label,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
        height: compact ? 62 : 52,
        padding: EdgeInsets.symmetric(horizontal: compact ? 16 : 18),
        decoration: BoxDecoration(
          gradient: selected ? (create ? Palette.accentGradient : const LinearGradient(colors: [Palette.surfaceTop, Palette.surfaceHigh])) : null,
          borderRadius: BorderRadius.circular(Radii.pill),
          boxShadow: selected && create ? [BoxShadow(color: Palette.accentHot.withValues(alpha: 0.4), blurRadius: 18, offset: const Offset(0, 6))] : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                icon,
                if (badge != null)
                  Positioned(
                    right: -8,
                    top: -6,
                    child: Container(
                      constraints: const BoxConstraints(minWidth: 22),
                      height: 22,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      decoration: BoxDecoration(color: Palette.rose, borderRadius: BorderRadius.circular(11), border: Border.all(color: Palette.night, width: 2)),
                      alignment: Alignment.center,
                      child: Text('$badge', style: Txt.small.copyWith(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 11.5)),
                    ),
                  ),
              ],
            ),
            if (!compact || selected) ...[
              const SizedBox(width: 9),
              Text(tab.label, style: Txt.strong.copyWith(fontSize: 15.5, color: selected && create ? Palette.accentInk : (selected ? Palette.text : Palette.textSoft))),
            ],
          ],
        ),
      ),
    );
  }
}
