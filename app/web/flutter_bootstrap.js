{{flutter_js}}
{{flutter_build_config}}

// Storia marche sans Internet : le moteur de rendu (CanvasKit) est servi par le studio, pas par un CDN.
_flutter.loader.load({
  config: {
    canvasKitBaseUrl: 'canvaskit/',
  },
});
