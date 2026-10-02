import 'dart:async';
import 'dart:js_interop';

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

/// La page du lecteur d'une histoire, dans un cadre qui remplit l'espace.
class StoryFrame extends StatelessWidget {
  const StoryFrame({super.key, required this.url});

  final String url;

  @override
  Widget build(BuildContext context) => HtmlElementView.fromTagName(
        key: ValueKey(url),
        tagName: 'iframe',
        onElementCreated: (element) {
          final frame = element as web.HTMLIFrameElement;
          frame.src = url;
          // Le geste qui a ouvert le lecteur vaut pour le son du cadre, et l'écran reste allumé pendant l'histoire.
          frame.allow = 'autoplay; fullscreen; screen-wake-lock';
          frame.style
            ..border = '0'
            ..width = '100%'
            ..height = '100%'
            ..backgroundColor = '#060a14';
        },
      );
}

/// L'animation d'une histoire, muette et en boucle.
class LoopVideo extends StatelessWidget {
  const LoopVideo({super.key, required this.url, this.poster});

  final String url;
  final String? poster;

  @override
  Widget build(BuildContext context) => HtmlElementView.fromTagName(
        key: ValueKey(url),
        tagName: 'video',
        isVisible: true,
        onElementCreated: (element) {
          final video = element as web.HTMLVideoElement;
          video
            ..src = url
            ..muted = true
            ..loop = true
            ..autoplay = true
            ..playsInline = true;
          if (poster != null) video.poster = poster!;
          video.style
            ..width = '100%'
            ..height = '100%'
            ..objectFit = 'cover'
            ..pointerEvents = 'none';
          video.play().toDart.ignore();
        },
      );
}

/// Un message du lecteur : { type: 'storia:…' }.
extension type _PlayerMessage(JSObject _) implements JSObject {
  external JSAny? get type;
}

/// Écoute les messages du lecteur (storia:fermer, storia:fin…). Renvoie de quoi arrêter d'écouter.
VoidCallback listenToPlayer(void Function(String type) onMessage) {
  final origin = web.window.location.origin;
  final JSFunction listener = ((web.MessageEvent event) {
    if (event.origin != origin) return; // seulement les pages du studio
    final data = event.data;
    if (data == null || !data.isA<JSObject>()) return;
    final type = _PlayerMessage(data as JSObject).type;
    if (type != null && type.isA<JSString>()) onMessage((type as JSString).toDart);
  }).toJS;
  web.window.addEventListener('message', listener);
  return () => web.window.removeEventListener('message', listener);
}

/// Le studio : celui qui a servi la page.
Uri pageOrigin() => Uri.parse(web.window.location.origin);
