// Les données échangées avec le studio (serveur/), telles que son API les renvoie.
import 'package:flutter/painting.dart';

Color _hex(String value) => Color(int.parse(value.replaceFirst('#', ''), radix: 16) | 0xFF000000);

DateTime? _date(Object? value) => value is String ? DateTime.tryParse(value)?.toLocal() : null;

double _number(Object? value) => value is num ? value.toDouble() : 0;

class StoryTheme {
  const StoryTheme({required this.id, required this.label, required this.tagline, required this.emoji, required this.colors});

  factory StoryTheme.fromJson(Map<String, dynamic> json) => StoryTheme(
        id: json['id'] as String,
        label: json['label'] as String,
        tagline: json['accroche'] as String? ?? '',
        emoji: json['emoji'] as String,
        colors: [for (final c in json['couleurs'] as List) _hex(c as String)],
      );

  final String id;
  final String label;
  final String tagline;
  final String emoji;
  final List<Color> colors;

  LinearGradient get gradient => LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: colors);
}

/// Les ingrédients d'une histoire, dans l'ordre où l'enfant les choisit.
enum Kind {
  heros('heros', 'Le héros', 'Qui est le héros\u00A0?'),
  lieu('lieu', 'Le lieu', 'Où se passe l’histoire\u00A0?'),
  compagnon('compagnon', 'Le compagnon', 'Qui l’accompagne\u00A0?'),
  objet('objet', 'L’objet magique', 'Quel objet magique\u00A0?'),
  rebondissement('rebondissement', 'La surprise', 'Et soudain…');

  const Kind(this.key, this.label, this.question);

  final String key;
  final String label;
  final String question;
}

class Ingredient {
  const Ingredient({required this.id, required this.label, required this.text, required this.emoji, this.themes});

  factory Ingredient.fromJson(Map<String, dynamic> json) => Ingredient(
        id: json['id'] as String,
        label: json['label'] as String,
        text: json['texte'] as String,
        emoji: json['emoji'] as String,
        themes: (json['themes'] as List?)?.cast<String>(),
      );

  final String id;
  final String label;
  final String text;
  final String emoji;

  /// Thèmes pour lesquels cet ingrédient est fait ; null : il va partout.
  final List<String>? themes;

  bool suits(String? themeId) => themes == null || themeId == null || themes!.contains(themeId);

  bool get feminine => text.startsWith('une ');

  /// « la renarde », « l’ourson », « le hérisson » (h aspiré : pas d’élision).
  String get withArticle {
    final word = label.toLowerCase();
    if (RegExp(r'^[aeiouyéèêîôâ]').hasMatch(word)) return 'l’$word';
    return '${feminine ? 'la' : 'le'} $word';
  }

  /// « de la renarde », « du hérisson », « de l’ourson ».
  String get afterDe => withArticle.startsWith('le ') ? 'du ${withArticle.substring(3)}' : 'de $withArticle';
}

/// Un choix simple : une tranche d'âge, une durée.
class Option {
  const Option({required this.id, required this.label, this.detail = ''});

  final String id;
  final String label;
  final String detail;
}

class Abilities {
  const Abilities({this.voice = false, this.image, this.animation = false});

  factory Abilities.fromJson(Map<String, dynamic>? json) => Abilities(
        voice: json?['voix'] == true,
        image: json?['image'] as String?,
        animation: json?['animation'] == true,
      );

  final bool voice;

  /// wan, comfy, ou null quand les histoires n'ont pas d'illustration.
  final String? image;
  final bool animation;
}

class Catalogue {
  const Catalogue({required this.themes, required this.ingredients, required this.durations, required this.ages, required this.abilities});

  factory Catalogue.fromJson(Map<String, dynamic> json) {
    final ingredients = json['ingredients'] as Map<String, dynamic>;
    return Catalogue(
      themes: [for (final t in json['themes'] as List) StoryTheme.fromJson(t as Map<String, dynamic>)],
      ingredients: {
        for (final kind in Kind.values) kind: [for (final i in ingredients[kind.key] as List) Ingredient.fromJson(i as Map<String, dynamic>)],
      },
      durations: [
        for (final d in json['durees'] as List)
          Option(id: d['id'] as String, label: _capitalize(d['label'] as String), detail: d['minutes'] as String? ?? ''),
      ],
      ages: [for (final a in json['ages'] as List) Option(id: a['id'] as String, label: ageLabel(a['id'] as String), detail: a['label'] as String)],
      abilities: Abilities.fromJson(json['capacites'] as Map<String, dynamic>?),
    );
  }

  final List<StoryTheme> themes;
  final Map<Kind, List<Ingredient>> ingredients;
  final List<Option> durations;
  final List<Option> ages;
  final Abilities abilities;

  StoryTheme? theme(String? id) {
    for (final t in themes) {
      if (t.id == id) return t;
    }
    return null;
  }

  Ingredient? ingredient(Kind kind, String? id) {
    for (final i in ingredients[kind]!) {
      if (i.id == id) return i;
    }
    return null;
  }
}

String _capitalize(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

/// « 3-5 » devient « 3-5 ans », « ados » devient « Ados ».
String ageLabel(String id) => RegExp(r'^\d').hasMatch(id) ? '$id ans' : _capitalize(id);

/// Ce que l'enfant a choisi. Ce qui manque est tiré au sort au moment de lancer l'histoire.
class Composition {
  const Composition({this.theme, this.picks = const {}, this.idea = '', this.age = '6-8', this.duration = 'courte'});

  factory Composition.fromJson(Map<String, dynamic> json) => Composition(
        theme: json['theme'] as String?,
        picks: {
          for (final kind in Kind.values)
            if (json[kind.key] is String) kind: json[kind.key] as String,
        },
        idea: json['idee'] as String? ?? '',
        age: json['age'] as String? ?? '6-8',
        duration: json['duree'] as String? ?? 'courte',
      );

  final String? theme;
  final Map<Kind, String> picks;
  final String idea;
  final String age;
  final String duration;

  String? operator [](Kind kind) => picks[kind];

  bool get isComplete => theme != null && Kind.values.every(picks.containsKey);

  bool get isEmpty => theme == null && picks.isEmpty;

  Composition copyWith({String? age, String? duration, String? idea}) =>
      Composition(theme: theme, picks: picks, idea: idea ?? this.idea, age: age ?? this.age, duration: duration ?? this.duration);

  Composition withTheme(String? id) => Composition(theme: id, picks: picks, idea: idea, age: age, duration: duration);

  Composition withPick(Kind kind, String? id) {
    final next = Map<Kind, String>.of(picks);
    if (id == null) {
      next.remove(kind);
    } else {
      next[kind] = id;
    }
    return Composition(theme: theme, picks: next, idea: idea, age: age, duration: duration);
  }

  Map<String, dynamic> toJson() => {
        if (theme != null) 'theme': theme,
        for (final e in picks.entries) e.key.key: e.value,
        if (idea.trim().isNotEmpty) 'idee': idea.trim(),
        'age': age,
        'duree': duration,
      };
}

class Story {
  const Story({
    required this.id,
    required this.title,
    required this.teaser,
    required this.theme,
    required this.age,
    required this.seconds,
    required this.keywords,
    required this.reads,
    required this.favorite,
    required this.createdAt,
    required this.lastReadAt,
    required this.composition,
    required this.cover,
    required this.loop,
    required this.player,
    required this.text,
  });

  factory Story.fromJson(Map<String, dynamic> json) => Story(
        id: json['id'] as String,
        title: json['titre'] as String,
        teaser: json['accroche'] as String? ?? '',
        theme: json['theme'] as String?,
        age: json['age'] as String? ?? '6-8',
        seconds: (json['dureeSecondes'] as num?)?.round() ?? 0,
        keywords: (json['motsCles'] as List? ?? const []).cast<String>(),
        reads: (json['lectures'] as num?)?.round() ?? 0,
        favorite: json['favori'] == true,
        createdAt: _date(json['creeLe']) ?? DateTime.now(),
        lastReadAt: _date(json['derniereLecture']),
        composition: json['composition'] is Map ? Composition.fromJson(json['composition'] as Map<String, dynamic>) : null,
        cover: json['couverture'] as String?,
        loop: json['boucle'] as String?,
        player: json['lecteur'] as String,
        text: json['texte'] as String?,
      );

  final String id;
  final String title;
  final String teaser;
  final String? theme;
  final String age;
  final int seconds;
  final List<String> keywords;
  final int reads;
  final bool favorite;
  final DateTime createdAt;
  final DateTime? lastReadAt;
  final Composition? composition;

  /// Adresses relatives au studio : `/bibliotheque/<dossier>/…`
  final String? cover;
  final String? loop;
  final String player;

  /// Le texte entier, seulement dans la fiche d'une histoire.
  final String? text;

  /// « 1 min », « 3 min » : arrondi à la minute, jamais zéro.
  String get durationLabel => '${(seconds / 60).round().clamp(1, 999)} min';
}

class KeywordCount {
  const KeywordCount(this.keyword, this.stories);

  final String keyword;
  final int stories;
}

class LibraryPage {
  const LibraryPage({required this.stories, required this.total, required this.keywords, required this.storyCount, required this.readCount});

  factory LibraryPage.fromJson(Map<String, dynamic> json) => LibraryPage(
        stories: [for (final s in json['histoires'] as List) Story.fromJson(s as Map<String, dynamic>)],
        total: (json['total'] as num).round(),
        keywords: [for (final k in json['motsCles'] as List? ?? const []) KeywordCount(k['motCle'] as String, (k['histoires'] as num).round())],
        storyCount: (json['stats']?['histoires'] as num?)?.round() ?? 0,
        readCount: (json['stats']?['lectures'] as num?)?.round() ?? 0,
      );

  final List<Story> stories;
  final int total;
  final List<KeywordCount> keywords;

  /// Toute la bibliothèque, filtres compris ou non.
  final int storyCount;
  final int readCount;
}

enum CreationState {
  waiting('attente'),
  running('en_cours'),
  done('terminee'),
  failed('echec'),
  cancelled('annulee');

  const CreationState(this.key);

  final String key;

  static CreationState parse(String? key) => values.firstWhere((s) => s.key == key, orElse: () => waiting);

  bool get isPending => this == waiting || this == running;
}

/// Les étapes de fabrication, telles que l'atelier les montre.
enum MakingStep {
  texte('Écriture', 'Writing hand', 'L’histoire s’écrit'),
  voix('Voix', 'Studio microphone', 'Le conteur lit l’histoire'),
  image('Illustration', 'Artist palette', 'L’illustration se peint'),
  animation('Animation', 'Clapper board', 'L’image prend vie'),
  assemblage('Finitions', 'Wrapped gift', 'On emballe le tout');

  const MakingStep(this.label, this.emoji, this.doing);

  final String label;
  final String emoji;
  final String doing;

  static MakingStep parse(String? key) => values.firstWhere((s) => s.name == key, orElse: () => texte);
}

class StepProgress {
  const StepProgress(this.step, this.value);

  final MakingStep step;
  final double value;
}

class CreationProgress {
  const CreationProgress({required this.step, required this.value, required this.overall, required this.steps, this.detail, this.title, this.waitingFor});

  factory CreationProgress.fromJson(Map<String, dynamic> json) => CreationProgress(
        step: MakingStep.parse(json['etape'] as String?),
        value: _number(json['avancement']),
        overall: _number(json['global']),
        detail: json['detail'] as String?,
        title: json['titre'] as String?,
        waitingFor: json['attente'] as String?,
        steps: [
          for (final s in json['etapes'] as List? ?? const []) StepProgress(MakingStep.parse(s['id'] as String?), _number(s['avancement'])),
        ],
      );

  final MakingStep step;
  final double value;
  final double overall;
  final String? detail;
  final String? title;

  /// Ce qui manque pour avancer (un service à lancer).
  final String? waitingFor;
  final List<StepProgress> steps;
}

class Creation {
  const Creation({
    required this.id,
    required this.state,
    required this.position,
    required this.composition,
    required this.animation,
    required this.storyId,
    required this.title,
    required this.progress,
    required this.error,
    required this.requestedAt,
    required this.startedAt,
    required this.finishedAt,
  });

  factory Creation.fromJson(Map<String, dynamic> json) => Creation(
        id: json['id'] as String,
        state: CreationState.parse(json['etat'] as String?),
        position: (json['position'] as num?)?.round(),
        composition: Composition.fromJson(json['composition'] as Map<String, dynamic>),
        animation: json['animation'] == true,
        storyId: json['histoireId'] as String,
        title: json['titre'] as String?,
        progress: json['progression'] is Map ? CreationProgress.fromJson(json['progression'] as Map<String, dynamic>) : null,
        error: json['erreur'] as String?,
        requestedAt: _date(json['demandeeLe']) ?? DateTime.now(),
        startedAt: _date(json['commenceeLe']),
        finishedAt: _date(json['termineeLe']),
      );

  final String id;
  final CreationState state;
  final int? position;
  final Composition composition;
  final bool animation;
  final String storyId;
  final String? title;
  final CreationProgress? progress;
  final String? error;
  final DateTime requestedAt;
  final DateTime? startedAt;
  final DateTime? finishedAt;
}

class ServiceState {
  const ServiceState({required this.ok, required this.detail});

  factory ServiceState.fromJson(Map<String, dynamic> json) => ServiceState(ok: json['ok'] == true, detail: json['detail'] as String? ?? '');

  final bool ok;
  final String detail;
}

class Health {
  const Health({required this.queue, required this.text, required this.voice, required this.image, this.card});

  factory Health.fromJson(Map<String, dynamic> json) => Health(
        queue: ServiceState.fromJson(json['file'] as Map<String, dynamic>),
        text: ServiceState.fromJson(json['texte'] as Map<String, dynamic>),
        voice: json['voix'] is Map ? ServiceState.fromJson(json['voix'] as Map<String, dynamic>) : null,
        image: ServiceState.fromJson(json['image'] as Map<String, dynamic>),
        card: json['carte'] is Map ? ServiceState.fromJson(json['carte'] as Map<String, dynamic>) : null,
      );

  final ServiceState queue;
  final ServiceState text;

  /// null : la voix du navigateur.
  final ServiceState? voice;
  final ServiceState image;

  /// La carte graphique selon le gardien ; null quand le studio ne la réserve pas.
  final ServiceState? card;

  List<ServiceState> get problems => [queue, text, ?voice, image, ?card].where((s) => !s.ok).toList();
}
