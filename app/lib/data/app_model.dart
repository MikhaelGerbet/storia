// L'état partagé de l'application : le catalogue, les demandes en cours, l'état des services, les réglages des parents.
// Chaque morceau est un ValueNotifier : un écran ne se redessine que pour ce qu'il regarde.
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'models.dart';

class AppModel {
  AppModel(this.api);

  final StoriaApi api;
  final catalogue = ValueNotifier<Catalogue?>(null);
  final catalogueError = ValueNotifier<String?>(null);
  final creations = ValueNotifier<List<Creation>>(const []);
  final health = ValueNotifier<Health?>(null);

  /// Augmente quand la bibliothèque change (histoire prête, supprimée, favorite) : les listes se rechargent.
  final libraryVersion = ValueNotifier<int>(0);

  /// La composition en cours dans l'écran « Créer », gardée quand on change d'onglet.
  final draft = ValueNotifier<Composition>(const Composition());

  /// Animer l'illustration (plus long) quand le studio sait le faire.
  final animate = ValueNotifier<bool>(true);

  /// Les couleurs du ciel : celles de l'univers choisi ou de l'histoire ouverte, sinon la nuit par défaut.
  final glow = ValueNotifier<List<Color>?>(null);
  Object? _glowOwner;

  /// L'atelier est affiché : on suit les demandes de près.
  bool workshopVisible = false;

  final _finished = StreamController<Creation>.broadcast();

  /// Les histoires qui viennent d'être terminées, pour l'annoncer où qu'on soit.
  Stream<Creation> get finished => _finished.stream;

  SharedPreferences? _prefs;
  Timer? _creationsTimer;
  Timer? _healthTimer;
  Map<String, CreationState>? _known;

  Future<void> start() async {
    try {
      _prefs = await SharedPreferences.getInstance();
      final age = _prefs!.getString('age');
      final duration = _prefs!.getString('duree');
      draft.value = draft.value.copyWith(age: age, duration: duration);
      animate.value = _prefs!.getBool('animation') ?? true;
    } catch (_) {
      // Sans stockage (navigation privée) : les réglages par défaut.
    }
    await loadCatalogue();
    unawaited(refreshCreations());
    unawaited(refreshHealth());
    _healthTimer = Timer.periodic(const Duration(seconds: 20), (_) => refreshHealth());
  }

  Future<void> loadCatalogue() async {
    try {
      catalogue.value = await api.catalogue();
      catalogueError.value = null;
    } on ApiException catch (e) {
      catalogueError.value = e.message;
    }
  }

  Future<void> refreshHealth() async {
    try {
      health.value = await api.health();
    } on ApiException {
      // Le studio ne répond pas : le catalogue l'a déjà dit.
    }
  }

  Future<void> refreshCreations() async {
    _creationsTimer?.cancel();
    try {
      final next = await api.creations();
      final known = _known;
      if (known != null) {
        for (final c in next) {
          final before = known[c.id];
          if (c.state == CreationState.done && before != null && before.isPending) _finished.add(c);
        }
        if (next.any((c) => c.state == CreationState.done && known[c.id] != CreationState.done)) libraryVersion.value++;
      }
      _known = {for (final c in next) c.id: c.state};
      creations.value = next;
    } on ApiException {
      // On réessaie au prochain tour.
    }
    final busy = creations.value.any((c) => c.state.isPending);
    _creationsTimer = Timer(Duration(milliseconds: busy || workshopVisible ? 1500 : 8000), refreshCreations);
  }

  void setDraft(Composition next) {
    draft.value = next;
    _prefs?.setString('age', next.age);
    _prefs?.setString('duree', next.duration);
  }

  void setAnimate(bool value) {
    animate.value = value;
    _prefs?.setBool('animation', value);
  }

  Future<Creation> create(Composition composition) async {
    final abilities = catalogue.value?.abilities;
    final created = await api.create(composition, animation: (abilities?.animation ?? false) && animate.value);
    _known = {...?_known, created.id: created.state};
    creations.value = [...creations.value.where((c) => c.id != created.id), created];
    unawaited(refreshCreations());
    return created;
  }

  Future<void> cancel(Creation creation) async {
    await api.cancel(creation.id);
    creations.value = creations.value.where((c) => c.id != creation.id || c.state == CreationState.running).toList();
    await refreshCreations();
  }

  Future<void> retry(Creation creation) async {
    final again = await api.retry(creation.id);
    _known = {...?_known, again.id: again.state};
    creations.value = [...creations.value.where((c) => c.id != creation.id), again];
    await refreshCreations();
  }

  void libraryChanged() => libraryVersion.value++;

  /// Teinte le ciel. Chaque écran ne retire que sa propre teinte : l'écran suivant a peut-être déjà posé la sienne.
  void setGlow(Object owner, List<Color>? colors) {
    _glowOwner = owner;
    glow.value = colors;
  }

  void clearGlow(Object owner) {
    if (_glowOwner != owner) return;
    _glowOwner = null;
    glow.value = null;
  }

  void dispose() {
    _creationsTimer?.cancel();
    _healthTimer?.cancel();
    _finished.close();
  }
}
