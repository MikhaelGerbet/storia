// Ce qui dépend du navigateur : la page du lecteur, les vidéos en boucle, les messages du lecteur.
// Hors navigateur (application de bureau ou mobile), des remplaçants simples prennent le relais.
export 'html_view_stub.dart' if (dart.library.js_interop) 'html_view_web.dart';
