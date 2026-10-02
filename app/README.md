# Storia, l'application

L'application de Storia, en Flutter (web). Elle tourne dans le navigateur du PC, d'une tablette ou d'un téléphone, et parle au studio (`serveur/`), qui la sert.

| Écran | Ce qu'on y fait |
|---|---|
| **Bibliothèque** | Retrouver ses histoires : recherche (sans accents, début des mots), univers, tris (récentes, plus écoutées, écoutées récemment), favorites, mots-clés |
| **Créer** | Composer une histoire en six cases (univers, héros, lieu, compagnon, objet magique, surprise), ou lancer le dé. Ce qu'on choisit est verrouillé : le dé ne tire que le reste. Réglages des parents repliés : âge, durée, idée, illustration animée |
| **Atelier** | Suivre la fabrication en direct (écriture, voix, illustration, animation, finitions), la file d'attente, arrêter, relancer, lire le détail d'un échec |
| **Histoire** | La fiche : illustration (animée si elle l'est), résumé, écoutes, mots-clés, ingrédients, texte, « inventer une histoire semblable » |
| **Écoute** | Le lecteur en plein écran. L'histoire démarre seule, et chaque écoute est comptée |

## Compiler

Avec Flutter 3.32 ou plus récent (testé avec 3.47) :

```bash
cd app
flutter pub get
flutter build web --no-web-resources-cdn
```

Le studio sert ensuite `app/build/web` sur http://localhost:3000. `--no-web-resources-cdn` garde tout en local : le moteur de rendu (CanvasKit) vient du studio et pas d'un CDN de Google, donc l'application marche sans Internet.

## Développer

1. Lance le studio, avec ses vrais services ou en démo :

   ```bash
   cd serveur
   npm run demo
   ```

   En démo, un faux conteur écrit en quelques secondes et le navigateur prête sa voix. Il faut seulement Redis.

2. Lance l'application en rechargement à chaud, en lui donnant l'adresse du studio :

   ```bash
   cd app
   flutter run -d chrome --dart-define=STORIA_API=http://localhost:3000
   ```

3. Avant de committer :

   ```bash
   flutter analyze
   flutter test
   ```

## Organisation

```
lib/
  main.dart             routes (go_router), thème, annonces « histoire prête »
  shell.dart            logo et navigation : en haut sur grand écran, en bas sur téléphone
  app_scope.dart        donne l'état aux écrans
  data/
    models.dart         les données de l'API (catalogue, composition, histoire, demande…)
    api.dart            le client de l'API du studio
    app_model.dart      l'état partagé, en ValueNotifier : catalogue, demandes, santé des services
  screens/              bibliothèque, créer, atelier, histoire, écoute
  ui/
    theme.dart          couleurs, typographie, tailles d'écran
    widgets.dart        emoji 3D, surfaces qui réagissent, boutons, pastilles, états vides
    story_visuals.dart  couvertures, cartes, constellation d'une composition
    backdrop.dart       le ciel étoilé, teinté par l'univers choisi
    format.dart         dates et pluriels en français
  platform/             le lecteur (iframe) et les vidéos en boucle, avec un remplaçant hors navigateur
```

## Crédits

- Emojis 3D : [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) de Microsoft, licence MIT (`assets/emoji/LICENSE`).
- Polices : [Fraunces](https://github.com/undercasetype/Fraunces) (version « douce », axe SOFT à 100) et [Nunito](https://github.com/googlefonts/nunito), licence SIL Open Font License (`assets/fonts/`).

Ces licences sont aussi listées dans l'application (`showLicensePage`).
