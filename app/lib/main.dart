// Storia : la bibliothèque d'histoires, l'atelier d'invention et le lecteur, servis par le studio (serveur/).
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:go_router/go_router.dart';

import 'app_scope.dart';
import 'data/api.dart';
import 'data/app_model.dart';
import 'data/models.dart';
import 'platform/html_view.dart';
import 'screens/create_screen.dart';
import 'screens/library_screen.dart';
import 'screens/player_screen.dart';
import 'screens/story_screen.dart';
import 'screens/workshop_screen.dart';
import 'shell.dart';
import 'ui/backdrop.dart';
import 'ui/theme.dart';
import 'ui/widgets.dart';

void main() {
  usePathUrlStrategy();
  LicenseRegistry.addLicense(_licenses);
  // En développement (flutter run), l'adresse du studio se donne avec --dart-define=STORIA_API=http://localhost:3000
  const configured = String.fromEnvironment('STORIA_API');
  final model = AppModel(StoriaApi(configured.isEmpty ? pageOrigin() : Uri.parse(configured)));
  unawaited(model.start());
  runApp(StoriaApp(model: model));
}

Stream<LicenseEntry> _licenses() async* {
  yield LicenseEntryWithLineBreaks(['Fraunces'], await rootBundle.loadString('assets/fonts/OFL-Fraunces.txt'));
  yield LicenseEntryWithLineBreaks(['Nunito'], await rootBundle.loadString('assets/fonts/OFL-Nunito.txt'));
  yield LicenseEntryWithLineBreaks(['Fluent Emoji'], await rootBundle.loadString('assets/emoji/LICENSE'));
}

/// Changement d'écran en fondu, légèrement zoomé : doux pour les yeux.
CustomTransitionPage<void> _page(GoRouterState state, Widget child) => CustomTransitionPage<void>(
      key: state.pageKey,
      child: child,
      transitionDuration: const Duration(milliseconds: 360),
      reverseTransitionDuration: const Duration(milliseconds: 260),
      transitionsBuilder: (context, animation, secondary, child) {
        final curved = CurvedAnimation(parent: animation, curve: Curves.easeOutCubic);
        return FadeTransition(opacity: curved, child: ScaleTransition(scale: Tween(begin: 0.985, end: 1.0).animate(curved), child: child));
      },
    );

class StoriaApp extends StatefulWidget {
  const StoriaApp({super.key, required this.model});

  final AppModel model;

  @override
  State<StoriaApp> createState() => _StoriaAppState();
}

class _StoriaAppState extends State<StoriaApp> {
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  late final StreamSubscription<Creation> _finished;
  late final GoRouter _router = GoRouter(
    routes: [
      ShellRoute(
        builder: (context, state, child) => AppShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(path: '/', pageBuilder: (context, state) => _page(state, LibraryScreen(query: state.uri.queryParameters['q']))),
          GoRoute(path: '/creer', pageBuilder: (context, state) => _page(state, const CreateScreen())),
          GoRoute(path: '/atelier', pageBuilder: (context, state) => _page(state, const WorkshopScreen())),
        ],
      ),
      GoRoute(path: '/histoire/:id', pageBuilder: (context, state) => _page(state, StoryScreen(id: state.pathParameters['id']!))),
      GoRoute(path: '/ecouter/:id', pageBuilder: (context, state) => _page(state, PlayerScreen(id: state.pathParameters['id']!))),
    ],
  );

  @override
  void initState() {
    super.initState();
    widget.model.catalogue.addListener(_precacheEmojis);
    WidgetsBinding.instance.addPostFrameCallback((_) => _precacheEmojis());
    // Une histoire vient d'être terminée : on le dit, où qu'on soit.
    _finished = widget.model.finished.listen((creation) {
      final messenger = _messenger.currentState;
      if (messenger == null) return;
      final title = creation.title ?? 'Ton histoire';
      showToastOn(messenger, '«\u00A0$title\u00A0» est prête\u00A0!', emoji: 'Party popper', actionLabel: 'Écouter', onAction: () => _router.push('/histoire/${creation.storyId}'));
    });
  }

  /// Les emojis du catalogue sont décodés d'avance : le dé s'arrête net sur la bonne image.
  void _precacheEmojis() {
    final catalogue = widget.model.catalogue.value;
    final context = _messenger.currentContext;
    if (catalogue == null || context == null) return;
    final names = {for (final t in catalogue.themes) t.emoji, for (final items in catalogue.ingredients.values) for (final i in items) i.emoji};
    for (final name in names) {
      precacheImage(AssetImage(Emoji.assetOf(name)), context);
    }
  }

  @override
  void dispose() {
    widget.model.catalogue.removeListener(_precacheEmojis);
    _finished.cancel();
    widget.model.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AppScope(
        model: widget.model,
        child: MaterialApp.router(
          title: 'Storia',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(),
          scaffoldMessengerKey: _messenger,
          routerConfig: _router,
          locale: const Locale('fr'),
          supportedLocales: const [Locale('fr')],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          builder: (context, child) => ValueListenableBuilder<List<Color>?>(
            valueListenable: widget.model.glow,
            builder: (context, glow, child) => glow == null ? NightBackdrop(child: child!) : NightBackdrop(glow: glow, child: child!),
            child: child ?? const SizedBox.shrink(),
          ),
        ),
      );
}
