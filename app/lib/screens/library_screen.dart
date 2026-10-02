// La bibliothèque : chercher, filtrer par thème, trier, et retrouver ses histoires préférées.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../app_scope.dart';
import '../data/api.dart';
import '../data/app_model.dart';
import '../data/models.dart';
import '../shell.dart';
import '../ui/format.dart';
import '../ui/story_visuals.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key, this.query});

  /// Recherche reçue par l'adresse (/?q=boussole), par exemple depuis un mot-clé d'une histoire.
  final String? query;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  final _search = TextEditingController();
  final _searchFocus = FocusNode();
  late final AppModel _model;
  Timer? _debounce;
  String? _theme;
  LibrarySort _sort = LibrarySort.recent;
  bool _favorites = false;
  LibraryPage? _page;
  String? _error;
  bool _loading = true;
  bool _loadingMore = false;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _model = AppScope.of(context);
    _search.text = widget.query ?? '';
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _model.libraryVersion.addListener(_reload);
      _load();
    });
  }

  @override
  void didUpdateWidget(LibraryScreen old) {
    super.didUpdateWidget(old);
    if (widget.query != old.query && widget.query != null) {
      _search.text = widget.query!;
      _load();
    }
  }

  @override
  void dispose() {
    _model.libraryVersion.removeListener(_reload);
    _debounce?.cancel();
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  void _reload() => _load(quiet: true);

  Future<void> _load({bool more = false, bool quiet = false}) async {
    final id = ++_request;
    setState(() {
      if (more) {
        _loadingMore = true;
      } else if (!quiet) {
        _loading = true;
      }
    });
    try {
      final page = await _model.api.stories(query: _search.text, theme: _theme, sort: _sort, favorites: _favorites, offset: more ? _page?.stories.length ?? 0 : 0);
      if (id != _request || !mounted) return;
      setState(() {
        _page = more && _page != null
            ? LibraryPage(stories: [..._page!.stories, ...page.stories], total: page.total, keywords: page.keywords, storyCount: page.storyCount, readCount: page.readCount)
            : page;
        _error = null;
      });
    } on ApiException catch (e) {
      if (id == _request && mounted) setState(() => _error = e.message);
    } finally {
      if (id == _request && mounted) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 280), _load);
    setState(() {});
  }

  void _setQuery(String text) {
    _search.text = text;
    _searchFocus.unfocus();
    _load();
  }

  Future<void> _toggleFavorite(Story story) async {
    final page = _page;
    if (page == null) return;
    Story swap(Story s, bool favorite) => Story(
          id: s.id, title: s.title, teaser: s.teaser, theme: s.theme, age: s.age, seconds: s.seconds, keywords: s.keywords, reads: s.reads,
          favorite: favorite, createdAt: s.createdAt, lastReadAt: s.lastReadAt, composition: s.composition, cover: s.cover, loop: s.loop, player: s.player, text: s.text,
        );
    void apply(bool favorite) => setState(() {
          _page = LibraryPage(
            stories: [for (final s in _page!.stories) s.id == story.id ? swap(s, favorite) : s],
            total: _page!.total,
            keywords: _page!.keywords,
            storyCount: _page!.storyCount,
            readCount: _page!.readCount,
          );
        });
    apply(!story.favorite); // tout de suite à l'écran, puis au studio
    try {
      await _model.api.setFavorite(story.id, !story.favorite);
      if (!story.favorite && mounted) showToast(context, 'Ajoutée à tes favoris', emoji: 'Red heart');
      if (_favorites) _reload();
    } on ApiException catch (e) {
      apply(story.favorite);
      if (mounted) showToast(context, e.message, emoji: 'Warning');
    }
  }

  @override
  Widget build(BuildContext context) {
    final screen = screenOf(context);
    final insets = MediaQuery.paddingOf(context);
    return ValueListenableBuilder<Catalogue?>(
      valueListenable: _model.catalogue,
      builder: (context, catalogue, _) => LayoutBuilder(
        builder: (context, box) {
          final gutter = gutterOf(context);
          final side = math.max(gutter, (box.maxWidth - 1240) / 2);
          final width = box.maxWidth - 2 * side;
          final columns = screen == ScreenSize.compact ? 1 : math.max(2, math.min(4, (width / 330).floor()));
          final spacing = screen == ScreenSize.compact ? 18.0 : 24.0;
          final cardWidth = (width - (columns - 1) * spacing) / columns;
          final cardHeight = cardWidth / 1.6 + StoryCard.textHeight;
          return RefreshIndicator(
            onRefresh: () => _load(quiet: true),
            color: Palette.accent,
            child: CustomScrollView(
              slivers: [
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(side, insets.top + (screen == ScreenSize.compact ? 18 : 10), side, 0),
                  sliver: SliverList.list(
                    children: [
                      _Header(compact: screen == ScreenSize.compact, page: _page),
                      const SizedBox(height: 22),
                      _SearchField(controller: _search, focus: _searchFocus, onChanged: _onSearchChanged, onClear: () => _setQuery('')),
                      if (_page != null && _page!.keywords.isNotEmpty && _search.text.isEmpty) ...[
                        const SizedBox(height: 12),
                        _KeywordIdeas(keywords: _page!.keywords, onPick: _setQuery),
                      ],
                      const SizedBox(height: 18),
                    ],
                  ),
                ),
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 50,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: EdgeInsets.symmetric(horizontal: side),
                      children: [
                        ChoiceChipPill(
                          label: 'Toutes',
                          emoji: 'Books',
                          selected: _theme == null,
                          onTap: () {
                            setState(() => _theme = null);
                            _load();
                          },
                        ),
                        for (final theme in catalogue?.themes ?? const <StoryTheme>[]) ...[
                          const SizedBox(width: 10),
                          ChoiceChipPill(
                            label: theme.label,
                            emoji: theme.emoji,
                            gradient: theme.gradient,
                            selected: _theme == theme.id,
                            onTap: () {
                              setState(() => _theme = _theme == theme.id ? null : theme.id);
                              _load();
                            },
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(side, 16, side, 0),
                  sliver: SliverToBoxAdapter(
                    child: _SortRow(
                      searching: _search.text.trim().isNotEmpty,
                      sort: _sort,
                      favorites: _favorites,
                      total: _page?.total,
                      onSort: (sort) {
                        setState(() => _sort = sort);
                        _load();
                      },
                      onFavorites: () {
                        setState(() => _favorites = !_favorites);
                        _load();
                      },
                    ),
                  ),
                ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(side, 18, side, 0),
                  sliver: SliverToBoxAdapter(child: _InProgressBanner(model: _model)),
                ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(side, 6, side, 0),
                  sliver: _content(catalogue, columns, spacing, cardHeight),
                ),
                if (_page != null && _page!.stories.length < _page!.total)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 28),
                      child: Center(child: SoftButton(label: _loadingMore ? 'Chargement…' : 'Voir plus d’histoires', onPressed: _loadingMore ? null : () => _load(more: true))),
                    ),
                  ),
                SliverToBoxAdapter(child: SizedBox(height: insets.bottom + 40)),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _content(Catalogue? catalogue, int columns, double spacing, double cardHeight) {
    final delegate = SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: columns, mainAxisSpacing: spacing, crossAxisSpacing: spacing, mainAxisExtent: cardHeight);
    if (_loading && _page == null) {
      return SliverGrid(delegate: SliverChildBuilderDelegate((context, i) => const Shimmer(), childCount: columns * 2), gridDelegate: delegate);
    }
    if (_error != null && _page == null) {
      return SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.only(top: 40), child: ErrorPanel(message: _error!, onRetry: _load)));
    }
    final page = _page!;
    if (page.stories.isEmpty) {
      final filtered = _search.text.trim().isNotEmpty || _theme != null || _favorites;
      return SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.only(top: 36),
          child: filtered
              ? EmptyState(
                  emoji: _favorites ? 'Red heart' : 'Magnifying glass tilted left',
                  title: _favorites ? 'Pas encore de favorites' : 'Aucune histoire trouvée',
                  text: _favorites ? 'Touche le cœur d’une histoire pour la retrouver ici.' : 'Essaie un autre mot, ou un autre thème.',
                  action: SoftButton(
                    label: 'Tout afficher',
                    icon: Icons.close_rounded,
                    onPressed: () {
                      setState(() {
                        _theme = null;
                        _favorites = false;
                      });
                      _setQuery('');
                    },
                  ),
                )
              : EmptyState(
                  emoji: 'Teddy bear',
                  secondEmoji: 'Crescent moon',
                  title: 'Ta bibliothèque t’attend',
                  text: 'Invente ta première histoire\u00A0: choisis un héros, un lieu, une surprise… ou lance le dé\u00A0!',
                  action: GlowButton(label: 'Créer ma première histoire', emoji: 'Sparkles', onPressed: () => context.go('/creer')),
                ),
        ),
      );
    }
    return SliverGrid(
      gridDelegate: delegate,
      delegate: SliverChildBuilderDelegate(
        (context, i) {
          final story = page.stories[i];
          return FadeSlideIn(
            key: ValueKey(story.id),
            delay: Duration(milliseconds: 40 * math.min(i, 10)),
            child: StoryCard(
              story: story,
              catalogue: catalogue,
              api: _model.api,
              onOpen: () => context.push('/histoire/${story.id}'),
              onFavorite: () => _toggleFavorite(story),
            ),
          );
        },
        childCount: page.stories.length,
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.compact, required this.page});

  final bool compact;
  final LibraryPage? page;

  @override
  Widget build(BuildContext context) {
    final stats = page == null || page!.storyCount == 0
        ? null
        : '${plural(page!.storyCount, 'histoire')} · ${plural(page!.readCount, 'écoute')}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (compact) ...[const Logo(size: 26), const SizedBox(height: 18)],
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Eyebrow('${greeting()}\u00A0!', color: Palette.accent),
                  const SizedBox(height: 8),
                  Text('Quelle histoire, ce soir\u00A0?', style: compact ? Txt.h1 : Txt.hero),
                ],
              ),
            ),
            if (!compact && stats != null)
              Padding(
                padding: const EdgeInsets.only(left: 16, bottom: 6),
                child: MetaPill(text: stats, emoji: 'Books', background: Palette.surfaceHigh),
              ),
          ],
        ),
      ],
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller, required this.focus, required this.onChanged, required this.onClear});

  final TextEditingController controller;
  final FocusNode focus;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: TextField(
          controller: controller,
          focusNode: focus,
          onChanged: onChanged,
          textInputAction: TextInputAction.search,
          style: Txt.strong.copyWith(fontSize: 17),
          decoration: InputDecoration(
            hintText: 'Cherche un héros, un lieu, un mot…',
            prefixIcon: const Padding(padding: EdgeInsets.only(left: 14, right: 8), child: Emoji('Magnifying glass tilted left', size: 28)),
            prefixIconConstraints: const BoxConstraints(minWidth: 52, minHeight: 52),
            suffixIcon: controller.text.isEmpty
                ? null
                : Padding(padding: const EdgeInsets.only(right: 8), child: RoundButton(icon: Icons.close_rounded, tooltip: 'Effacer', size: 38, background: Palette.surfaceTop, onPressed: onClear)),
            contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(Radii.pill), borderSide: const BorderSide(color: Palette.line)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Radii.pill), borderSide: const BorderSide(color: Palette.line)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Radii.pill), borderSide: const BorderSide(color: Palette.accent, width: 2)),
          ),
        ),
      );
}

class _KeywordIdeas extends StatelessWidget {
  const _KeywordIdeas({required this.keywords, required this.onPick});

  final List<KeywordCount> keywords;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text('Idées\u00A0:', style: Txt.small.copyWith(color: Palette.textMute)),
          for (final k in keywords.take(8))
            Pressable(
              onTap: () => onPick(k.keyword),
              radius: Radii.pill,
              semanticLabel: 'Chercher $k',
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(Radii.pill), border: Border.all(color: Palette.line)),
                child: Text('#${k.keyword}', style: Txt.small.copyWith(color: Palette.textSoft)),
              ),
            ),
        ],
      );
}

class _SortRow extends StatelessWidget {
  const _SortRow({required this.searching, required this.sort, required this.favorites, required this.total, required this.onSort, required this.onFavorites});

  final bool searching;
  final LibrarySort sort;
  final bool favorites;
  final int? total;
  final ValueChanged<LibrarySort> onSort;
  final VoidCallback onFavorites;

  @override
  Widget build(BuildContext context) {
    final compact = screenOf(context) == ScreenSize.compact;
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (searching)
          Padding(padding: const EdgeInsets.only(right: 6), child: Text('Les plus proches de ta recherche', style: Txt.small.copyWith(color: Palette.textSoft)))
        else
          for (final s in [LibrarySort.recent, LibrarySort.popular, if (!compact) LibrarySort.listened])
            _SortTab(label: s.label, selected: sort == s, onTap: () => onSort(s)),
        _SortTab(label: 'Favorites', icon: favorites ? Icons.favorite_rounded : Icons.favorite_border_rounded, selected: favorites, onTap: onFavorites),
        if (total != null && !compact) Padding(padding: const EdgeInsets.only(left: 8), child: Text(plural(total!, 'histoire'), style: Txt.small)),
      ],
    );
  }
}

class _SortTab extends StatelessWidget {
  const _SortTab({required this.label, required this.selected, required this.onTap, this.icon});

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onTap,
        radius: Radii.pill,
        semanticLabel: label,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          height: 38,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: selected ? Palette.text : Colors.transparent,
            borderRadius: BorderRadius.circular(Radii.pill),
            border: Border.all(color: selected ? Palette.text : Palette.lineStrong),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 17, color: selected ? Palette.rose : Palette.textSoft), const SizedBox(width: 6)],
              Text(label, style: Txt.small.copyWith(color: selected ? Palette.abyss : Palette.textSoft, fontWeight: FontWeight.w800, fontSize: 13.5)),
            ],
          ),
        ),
      );
}

/// Un rappel discret des histoires en préparation, avec un lien vers l'atelier.
class _InProgressBanner extends StatelessWidget {
  const _InProgressBanner({required this.model});

  final AppModel model;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<List<Creation>>(
        valueListenable: model.creations,
        builder: (context, creations, _) {
          final pending = creations.where((c) => c.state.isPending).toList();
          if (pending.isEmpty) return const SizedBox.shrink();
          final running = pending.where((c) => c.state == CreationState.running).firstOrNull;
          final catalogue = model.catalogue.value;
          final hero = catalogue?.ingredient(Kind.heros, (running ?? pending.first).composition[Kind.heros]);
          final title = running?.title ?? (hero != null ? 'L’histoire ${hero.afterDe}' : 'Ton histoire');
          final more = pending.length > 1 ? ' (+${pending.length - 1} en attente)' : '';
          final progress = running?.progress;
          return Padding(
            padding: const EdgeInsets.only(bottom: 18),
            child: Pressable(
              onTap: () => context.go('/atelier'),
              semanticLabel: 'Voir l’atelier',
              hoverScale: 1.01,
              child: Panel(
                padding: const EdgeInsets.fromLTRB(14, 12, 18, 12),
                radius: 22,
                gradient: LinearGradient(colors: [Palette.accent.withValues(alpha: 0.16), Palette.surface.withValues(alpha: 0.9)]),
                borderColor: Palette.accent.withValues(alpha: 0.35),
                child: Row(
                  children: [
                    ProgressRing(value: progress?.overall ?? 0, size: 52, stroke: 4.5, child: Emoji(hero?.emoji ?? 'Sparkles', size: 30)),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(running == null ? 'Une histoire attend son tour$more' : '«\u00A0$title\u00A0» se prépare$more', maxLines: 1, overflow: TextOverflow.ellipsis, style: Txt.strong),
                          const SizedBox(height: 2),
                          Text(
                            progress == null ? 'Elle sera bientôt dans ta bibliothèque.' : '${progress.step.doing}… ${(progress.overall * 100).round()} %',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Txt.small,
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: Palette.textSoft),
                  ],
                ),
              ),
            ),
          );
        },
      );
}
