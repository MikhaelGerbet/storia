import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:storia/data/api.dart';
import 'package:storia/data/models.dart';
import 'package:storia/ui/story_visuals.dart';
import 'package:storia/ui/theme.dart';

void main() {
  testWidgets('une carte montre le titre, le thème, les écoutes, et réagit au cœur', (tester) async {
    final catalogue = Catalogue.fromJson(jsonDecode(File('test/fixtures/catalogue.json').readAsStringSync()) as Map<String, dynamic>);
    final story = Story.fromJson({
      'id': 'h-1',
      'titre': 'La Boussole qui chantait',
      'accroche': 'Une renarde suit une boussole.',
      'theme': 'pirates',
      'age': '6-8',
      'dureeSecondes': 130,
      'motsCles': ['pirates'],
      'lectures': 4,
      'favori': false,
      'creeLe': '2026-09-01T10:00:00.000Z',
      'composition': {'theme': 'pirates', 'heros': 'renarde', 'age': '6-8', 'duree': 'courte'},
      'lecteur': '/bibliotheque/h-1/index.html',
    });
    var opened = 0;
    var hearts = 0;
    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(),
      home: Center(
        child: SizedBox(
          width: 340,
          height: 340 / 1.6 + StoryCard.textHeight,
          child: StoryCard(story: story, catalogue: catalogue, api: StoriaApi(Uri.parse('http://localhost:3000')), onOpen: () => opened++, onFavorite: () => hearts++),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('La Boussole qui chantait'), findsOneWidget);
    expect(find.text('Pirates'), findsOneWidget);
    expect(find.text('4'), findsOneWidget); // écoutes
    expect(find.text('2 min'), findsOneWidget);
    expect(tester.takeException(), isNull); // pas de débordement
    await tester.tap(find.byIcon(Icons.favorite_border_rounded));
    await tester.tap(find.text('La Boussole qui chantait'));
    expect(hearts, 1);
    expect(opened, 1);
  });
}
