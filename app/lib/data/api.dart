// Le client de l'API du studio. Toutes les erreurs arrivent sous forme d'ApiException, avec un message à montrer.
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.status});

  final String message;
  final int? status;

  @override
  String toString() => message;
}

enum LibrarySort {
  recent('recentes', 'Récentes'),
  popular('populaires', 'Les plus écoutées'),
  listened('ecoutees', 'Écoutées récemment'),
  short('courtes', 'Les plus courtes');

  const LibrarySort(this.key, this.label);

  final String key;
  final String label;
}

class StoriaApi {
  StoriaApi(this.base, {http.Client? client}) : _client = client ?? http.Client();

  /// Le studio : l'adresse de la page, ou celle donnée à la compilation (--dart-define=STORIA_API=…).
  final Uri base;
  final http.Client _client;

  /// Adresse complète d'un fichier du studio (couverture, animation, lecteur).
  String url(String path) => base.resolve(path).toString();

  Future<dynamic> _send(String method, String path, {Object? body, Map<String, String>? query}) async {
    final request = http.Request(method, base.replace(path: path, queryParameters: query == null || query.isEmpty ? null : query));
    if (body != null) {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    late final http.StreamedResponse response;
    try {
      response = await _client.send(request).timeout(const Duration(seconds: 20));
    } catch (_) {
      throw const ApiException('Le studio ne répond pas. Vérifie qu’il est lancé (npm start dans serveur).');
    }
    final text = await response.stream.bytesToString();
    final data = text.isEmpty ? null : jsonDecode(text);
    if (response.statusCode >= 400) {
      final message = data is Map && data['erreur'] is String ? data['erreur'] as String : 'Erreur ${response.statusCode}';
      throw ApiException(message, status: response.statusCode);
    }
    return data;
  }

  Future<Catalogue> catalogue() async => Catalogue.fromJson(await _send('GET', '/api/catalogue') as Map<String, dynamic>);

  Future<Health> health() async => Health.fromJson(await _send('GET', '/api/sante') as Map<String, dynamic>);

  /// Tire au sort tout ce qui n'est pas encore choisi.
  Future<Composition> draw(Composition kept) async {
    final data = await _send('POST', '/api/composition/hasard', body: kept.toJson()) as Map<String, dynamic>;
    return Composition.fromJson({...data, 'idee': kept.idea});
  }

  Future<LibraryPage> stories({String query = '', String? theme, LibrarySort sort = LibrarySort.recent, bool favorites = false, int offset = 0}) async {
    final params = {
      if (query.trim().isNotEmpty) 'q': query.trim(),
      'theme': ?theme,
      if (query.trim().isEmpty || sort != LibrarySort.recent) 'tri': sort.key,
      if (favorites) 'favoris': '1',
      if (offset > 0) 'decalage': '$offset',
      'limite': '48',
    };
    return LibraryPage.fromJson(await _send('GET', '/api/histoires', query: params) as Map<String, dynamic>);
  }

  Future<Story> story(String id) async => Story.fromJson(await _send('GET', '/api/histoires/$id') as Map<String, dynamic>);

  Future<Story> countRead(String id) async => Story.fromJson(await _send('POST', '/api/histoires/$id/lecture', body: const {}) as Map<String, dynamic>);

  Future<Story> setFavorite(String id, bool favorite) async =>
      Story.fromJson(await _send('POST', '/api/histoires/$id/favori', body: {'favori': favorite}) as Map<String, dynamic>);

  Future<void> deleteStory(String id) => _send('DELETE', '/api/histoires/$id');

  Future<List<Creation>> creations() async {
    final data = await _send('GET', '/api/creations') as Map<String, dynamic>;
    return [for (final c in data['creations'] as List) Creation.fromJson(c as Map<String, dynamic>)];
  }

  Future<Creation> create(Composition composition, {required bool animation}) async =>
      Creation.fromJson(await _send('POST', '/api/creations', body: {'composition': composition.toJson(), 'animation': animation}) as Map<String, dynamic>);

  /// Retire une demande en attente ou terminée ; arrête une fabrication en cours.
  Future<void> cancel(String id) => _send('DELETE', '/api/creations/$id');

  Future<Creation> retry(String id) async => Creation.fromJson(await _send('POST', '/api/creations/$id/relancer', body: const {}) as Map<String, dynamic>);

  Future<List<String>> journal(String id) async {
    final data = await _send('GET', '/api/creations/$id/journal') as Map<String, dynamic>;
    return (data['lignes'] as List).cast<String>();
  }
}
