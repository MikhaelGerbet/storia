# Storia · « Raconte-moi une histoire » (nom provisoire)

Des histoires à écouter, générées par IA. On choisit un thème (pirates, espace, princesses…) ou on dicte une idée ; une histoire adaptée à l'âge est écrite, racontée par une voix expressive avec ambiance sonore et bruitages, sur une illustration légèrement animée. Les histoires rejoignent un catalogue qu'on peut réécouter. En V2, on pourra influencer la suite pendant l'écoute.

## État

| Dossier | Contenu |
|---|---|
| `prototype/intro-pirate/` | Prototype n°1 : le lecteur. 15 secondes d'intro pour juger l'expérience (voix, sons, animation). Ouvrir `index.html`. |
| `generator/` | Prototype n°2 : génère l'intro de bout en bout sur le PC (texte avec Ollama, voix avec Pocket TTS, image avec ComfyUI) et l'assemble dans une page jouable. Voir son README. |

## Décisions prises

- **Projet personnel, peut-être public plus tard.** On choisit dès maintenant des modèles et des sons dont la licence permet un usage commercial, pour ne rien refaire.
- **Budget 0 € au départ** : tout tourne sur le PC, avec les quotas gratuits des services en appoint.
- **Matériel** : Ryzen 7 7700X, 128 Go de RAM, Radeon RX 7900 XT (20 Go). Texte et images sur la carte graphique (Ollama et ComfyUI, via ROCm), voix sur le processeur (Pocket TTS).
- **V1 tous publics**, avec des niveaux d'âge (enfants, ados, adultes) qui pilotent le texte, la voix, les sons et les images.
- **Pas d'IA Google** (API Gemini, Vertex AI, Gemini Nano) : leurs conditions interdisent les services susceptibles d'être utilisés par des moins de 18 ans. Restent possibles, avec des garde-fous : Mistral, OpenAI, Anthropic, Cloudflare Workers AI et les modèles libres en local.
- **Cible technique** : application Flutter (Android d'abord) et serveur TypeScript. Les prototypes sont en web pour aller vite.
- **Le téléphone écoute, mixe, anime et prend la dictée** ; la génération tourne sur le PC ou sur un service en ligne.

## Prochaines étapes

1. Juger l'intro avec la voix et l'image générées sur le PC.
2. Bibliothèque de sons enregistrés et autres décors (espace, forêt, château…).
3. Histoires complètes, générées pendant l'écoute (la lecture démarre en quelques secondes).
4. Niveaux d'âge complets et vraie modération (un second modèle relit chaque scène).
5. Application Flutter et catalogue.
6. V2 : choisir la suite pendant l'histoire.
