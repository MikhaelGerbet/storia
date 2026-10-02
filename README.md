# Storia · « Raconte-moi une histoire » (nom provisoire)

Des histoires à écouter, générées par IA. On choisit un thème (pirates, espace, princesses…) ou on dicte une idée ; une histoire adaptée à l'âge est écrite, racontée par une voix expressive avec ambiance sonore et bruitages, sur une illustration légèrement animée. Les histoires rejoignent un catalogue qu'on peut réécouter. En V2, on pourra influencer la suite pendant l'écoute.

## État

| Dossier | Contenu |
|---|---|
| `app/` | **L'application** (Flutter web). Bibliothèque avec recherche et favoris, création d'une histoire en six cases ou au dé, atelier qui montre la fabrication en direct, écoute en plein écran. Voir son README. |
| `serveur/` | **Le studio** (TypeScript, Node 22). Il sert l'application, range les histoires (SQLite, recherche plein texte) et les fabrique une à une (file BullMQ sur Redis). Voir son README. |
| `gardien/` | **Le gardien de la carte graphique.** Il fait passer un par un tous les programmes qui s'en servent (Storia, Oula…), la vide quand plus personne n'en a besoin et la réserve aux jeux. Voir son README. |
| `generator/` | La chaîne de fabrication d'une histoire : texte avec Ollama, voix, image et animation en boucle avec Wan 2.2 (ou image avec ComfyUI), le tout assemblé dans une page jouable. Utilisable seule en ligne de commande. |
| `prototype/intro-pirate/` | Le lecteur : voix, ambiance, bruitages, sous-titres, illustration animée. Chaque histoire est une page de ce lecteur. |
| `voix/` | Serveur de voix local (VoxCPM2, Chatterbox) et guide pour choisir et enregistrer la voix du conteur. |
| `docs/demarrer-sous-windows.md` | Installation pas à pas sous Windows, jusqu'à l'application. |

Pour essayer l'application sans les modèles : `npm run demo` dans `serveur/` (il faut seulement Redis).

## Décisions prises

- **Projet personnel, peut-être public plus tard.** On choisit dès maintenant des modèles et des sons dont la licence permet un usage commercial, pour ne rien refaire.
- **Budget 0 € au départ** : tout tourne sur le PC, avec les quotas gratuits des services en appoint.
- **Matériel** : Ryzen 7 7700X, 128 Go de RAM, Radeon RX 7900 XT (20 Go), Windows. Texte et images sur la carte graphique (Ollama et ComfyUI, via ROCm).
- **Voix** : la voix de synthèse du navigateur est jugée « horrible » ; il faut un modèle spécialisé. D'après un test d'écoute à l'aveugle en français, FireRedTTS3 est le meilleur modèle open source (presque au niveau d'ElevenLabs), devant VoxCPM2 et Chatterbox. VoxCPM2 est intégré par défaut car il est simple à installer ; FireRedTTS3 est la cible si l'écoute le confirme.
- **V1 tous publics**, avec des niveaux d'âge (enfants, ados, adultes) qui pilotent le texte, la voix, les sons et les images.
- **Pas d'IA Google** (API Gemini, Vertex AI, Gemini Nano) : leurs conditions interdisent les services susceptibles d'être utilisés par des moins de 18 ans. Restent possibles, avec des garde-fous : Mistral, OpenAI, Anthropic, Cloudflare Workers AI et les modèles libres en local.
- **Cible technique** : application Flutter et serveur TypeScript. L'application tourne d'abord dans le navigateur (PC, tablette), servie par le studio sur le PC ; Android viendra ensuite.
- **Application pensée pour un enfant avec un parent** : grandes cartes illustrées, peu de texte, un dé pour tout tirer au sort, réglages des parents repliés.
- **Le téléphone écoute, mixe, anime et prend la dictée** ; la génération tourne sur le PC ou sur un service en ligne.

## Prochaines étapes

1. Voir tourner l'animation Wan 2.2 de bout en bout sur le PC, puis régler les durées de fabrication.
2. Dictée de l'idée par l'enfant (reconnaissance vocale locale).
3. Bibliothèque de sons enregistrés pour remplacer les sons synthétisés.
4. Histoires générées pendant l'écoute (la lecture démarre en quelques secondes).
5. Vraie modération : un second modèle relit chaque histoire.
6. Application Android, puis V2 : choisir la suite pendant l'histoire.
