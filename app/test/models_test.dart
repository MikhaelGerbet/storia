import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:storia/data/models.dart';

void main() {
  final catalogue = Catalogue.fromJson(jsonDecode(File('test/fixtures/catalogue.json').readAsStringSync()) as Map<String, dynamic>);

  test('le catalogue du studio se lit entièrement', () {
    expect(catalogue.themes, hasLength(8));
    expect(catalogue.theme('espace')?.colors, hasLength(2));
    for (final kind in Kind.values) {
      expect(catalogue.ingredients[kind], isNotEmpty, reason: kind.key);
    }
    expect(catalogue.ages.map((a) => a.label), containsAll(['3-5 ans', '6-8 ans', 'Ados']));
    expect(catalogue.durations.first.label, 'Courte');
  });

  test('une composition va et revient du studio sans rien perdre', () {
    const c = Composition(theme: 'pirates', picks: {Kind.heros: 'renarde', Kind.objet: 'boussole'}, idea: '  un trésor  ', age: '3-5', duration: 'moyenne');
    final json = c.toJson();
    expect(json, {'theme': 'pirates', 'heros': 'renarde', 'objet': 'boussole', 'idee': 'un trésor', 'age': '3-5', 'duree': 'moyenne'});
    final back = Composition.fromJson(json);
    expect(back[Kind.heros], 'renarde');
    expect(back.isComplete, isFalse);
    expect(back.withPick(Kind.objet, null)[Kind.objet], isNull);
    expect(const Composition().toJson(), {'age': '6-8', 'duree': 'courte'}); // rien de choisi : tout au hasard
  });

  test('les articles s’accordent : la renarde, du hérisson, de l’ourson', () {
    String afterDe(String id) => catalogue.ingredient(Kind.heros, id)!.afterDe;
    expect(catalogue.ingredient(Kind.heros, 'renarde')!.withArticle, 'la renarde');
    expect(afterDe('renarde'), 'de la renarde');
    expect(afterDe('herisson'), 'du hérisson'); // h aspiré : pas d'élision
    expect(afterDe('ourson'), 'de l’ourson');
    expect(afterDe('dragonneau'), 'du petit dragon');
  });

  test('une demande en cours se lit avec ses étapes', () {
    final creation = Creation.fromJson({
      'id': 'h-1',
      'etat': 'en_cours',
      'position': null,
      'composition': {'theme': 'espace', 'age': '6-8', 'duree': 'courte'},
      'animation': true,
      'histoireId': 'h-1',
      'titre': null,
      'progression': {
        'etape': 'voix',
        'avancement': 0.5,
        'global': 0.42,
        'detail': 'phrase 2 sur 4',
        'titre': 'Le Robot des étoiles',
        'etapes': [
          {'id': 'texte', 'avancement': 1},
          {'id': 'voix', 'avancement': 0.5},
          {'id': 'assemblage', 'avancement': 0},
        ],
      },
      'erreur': null,
      'demandeeLe': '2026-10-02T09:00:00.000Z',
      'commenceeLe': '2026-10-02T09:00:01.000Z',
      'termineeLe': null,
    });
    expect(creation.state, CreationState.running);
    expect(creation.state.isPending, isTrue);
    expect(creation.progress?.step, MakingStep.voix);
    expect(creation.progress?.title, 'Le Robot des étoiles');
    expect(creation.progress?.steps.map((s) => s.step), [MakingStep.texte, MakingStep.voix, MakingStep.assemblage]);
  });

  test('une histoire dure au moins une minute à l’affichage', () {
    Story story(int seconds) => Story.fromJson({'id': 'a', 'titre': 'T', 'dureeSecondes': seconds, 'lecteur': '/bibliotheque/a/index.html'});
    expect(story(20).durationLabel, '1 min');
    expect(story(150).durationLabel, '3 min');
  });
}
