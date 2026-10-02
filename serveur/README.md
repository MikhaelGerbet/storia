# Le studio Storia

Le studio fait tourner l'application sur ton PC. Il sert l'application Flutter (`app/`) et range les histoires dans une bibliothèque. Il fabrique aussi les histoires demandées, une à la fois, avec la chaîne du générateur (`generator/`) : texte avec Ollama, voix, puis image et animation avec Wan 2.2.

```
Navigateur (PC, tablette)  ──►  Studio, port 3000 (Node 22)
                                 ├─ API /api/…
                                 ├─ application Flutter compilée (app/build/web)
                                 ├─ bibliothèque : SQLite + dossiers d'histoires
                                 └─ file de création BullMQ  ──►  Redis
                                        └─ travailleur : Ollama → voix → Wan2GP
```

## Installation (une seule fois)

1. **Node.js 22.18 ou plus récent**, comme pour le générateur.
2. **Redis**, pour la file de création. Sous Windows, voir `docs/demarrer-sous-windows.md`. En bref, avec Docker Desktop :

   ```bash
   docker run -d --name storia-redis -p 6379:6379 --restart unless-stopped redis:7-alpine
   ```

3. Les dépendances du studio (BullMQ) :

   ```bash
   cd serveur
   npm install
   ```

4. L'application, compilée avec Flutter (voir `app/README.md`) :

   ```bash
   cd app
   flutter build web --no-web-resources-cdn
   ```

## Lancer

```bash
cd serveur
npm start
```

Puis ouvre http://localhost:3000. Au démarrage, le studio vérifie chaque service et dit ce qui manque :

```
Storia est prêt : http://localhost:3000
  Bibliothèque : 12 histoires (P:\storia\storia\serveur\bibliotheque)
  ✓ File de création : Redis
  ✓ Texte : Ollama, modèle mistral-small3.2
  ✗ Voix : Le serveur de voix ne répond pas (http://localhost:8001) : lance-le, puis attends « Voix prête ».
  ✓ Image : Wan2GP 13.11 (Wan 2.2 image vers vidéo, Z-Image Turbo)
```

Un service absent n'empêche ni de lire les histoires ni d'en demander. Sans Ollama ou sans voix, une demande attend au début de sa fabrication : l'atelier de l'application dit ce qui manque, et elle repart d'elle-même dès que le service répond. Un modèle Ollama absent, lui, fait échouer la demande avec la commande pour l'installer.

Pour ouvrir l'application sur une tablette ou un téléphone du même Wi-Fi : `npm start -- --reseau`. Le studio affiche alors l'adresse à taper.

### Options

| Option | Rôle |
|---|---|
| `--port <n>` | port de l'application (3000) |
| `--reseau` | ouvre l'application aux autres appareils du réseau |
| `--redis <url>` | Redis (`redis://127.0.0.1:6379`) |
| `--bibliotheque <dir>` | dossier des histoires (`serveur/bibliotheque`) |
| `--ollama <url>`, `--modele <nom>` | le conteur (`mistral-small3.2`) |
| `--tts <url>`, `--sans-voix` | le serveur de voix (`http://localhost:8001`), ou la voix du navigateur |
| `--sans-wan` | ne cherche pas Wan2GP : pas d'illustration (sauf avec `--workflow`) |
| `--wan-dossier`, `--wan-etapes`, `--wan-image`, `--wan-modeles` | comme pour le générateur |
| `--workflow <json>`, `--comfy <url>` | image avec ComfyUI quand Wan2GP n'est pas là |
| `--app <dir>` | l'application compilée (`app/build/web`) |
| `--sans-travailleur` | l'API seulement ; un autre processus fabrique les histoires |
| `--gardien <url>`, `--sans-gardien` | le gardien de la carte graphique (`http://127.0.0.1:7870`), ou aucun si rien d'autre ne s'en sert |

**La carte graphique** se réserve auprès du gardien (`gardien/`) avant chaque histoire, en priorité haute : si Oula s'en sert, l'histoire attend la fin de sa tâche. Un jeu la reprend aussitôt, et l'histoire recommence du début après la partie. Le gardien lance aussi le serveur de voix s'il ne répond pas.

Wan2GP est cherché dans Pinokio comme pour le générateur. Chaque demande choisit ensuite entre une image fixe (rapide) et une image animée (plusieurs minutes de plus), dans les réglages des parents de l'application.

## Mode démo

```bash
npm run demo
```

Le studio complet avec un faux conteur qui écrit en quelques secondes. Il n'a ni voix (celle du navigateur la remplace) ni image. Il faut seulement Redis. Au premier lancement, il prépare six histoires pour remplir la bibliothèque, et ses histoires sont rangées à part (`serveur/bibliotheque-demo`). C'est pratique pour découvrir l'application, ou pour travailler son interface sans lancer les modèles.

## Importer les histoires du générateur

```bash
npm run importer                          # tout generator/sorties
npm run importer -- ../generator/sorties/2026-10-02_01h43m00-le-navire-endormi
```

Chaque dossier est copié dans la bibliothèque, sans le dossier de travail de Wan. Importer deux fois ne crée pas de doublon.

## Ce qui est rangé où

- `serveur/bibliotheque/bibliotheque.sqlite` : les fiches des histoires (titre, résumé, mots-clés, texte, lectures, favoris) et l'index de recherche plein texte. La recherche ignore les accents et trouve le début des mots.
- `serveur/bibliotheque/<id>/` : la page de l'histoire (`index.html`), l'image, l'animation, les voix, la scène et la fiche (`fiche.json`).
- Redis : la file de création seulement (demandes, avancement, journaux). Le vider ne fait perdre aucune histoire.

Les pages d'histoires sont servies avec la version actuelle du lecteur (`prototype/intro-pirate/index.html`) : une amélioration du lecteur profite aussi aux anciennes histoires.

## L'API

| Requête | Rôle |
|---|---|
| `GET /api/catalogue` | univers, ingrédients, âges, durées, et ce que le studio sait faire (voix, image, animation) |
| `POST /api/composition/hasard` | tire au sort ce qui n'est pas choisi (`{theme?, heros?, …, age, duree}`) |
| `GET /api/histoires?q=&theme=&age=&tri=&favoris=1&limite=&decalage=` | la bibliothèque ; `tri` : `recentes`, `populaires`, `ecoutees`, `courtes`, `pertinence` |
| `GET /api/histoires/:id` | une histoire, avec son texte |
| `POST /api/histoires/:id/lecture` | une écoute de plus |
| `POST /api/histoires/:id/favori` | `{favori: true}` ou `false` |
| `DELETE /api/histoires/:id` | supprime l'histoire et ses fichiers |
| `POST /api/creations` | demande une histoire : `{composition, animation}` |
| `GET /api/creations`, `GET /api/creations/:id` | les demandes : `attente` (avec leur rang), `en_cours` (avec l'avancement de chaque étape), `terminee`, `echec`, `annulee` |
| `GET /api/creations/:id/journal` | le journal de fabrication |
| `DELETE /api/creations/:id` | retire une demande, ou arrête une fabrication en cours (Wan2GP compris) |
| `POST /api/creations/:id/relancer` | recommence une demande échouée ou annulée |
| `GET /api/sante` | l'état de Redis, d'Ollama, de la voix et de l'image |

Les requêtes qui modifient quelque chose doivent être en JSON : une autre page web ne peut donc pas les envoyer à ton insu. Seule l'application en développement (`flutter run`, sur `localhost`) a le droit d'appeler l'API depuis une autre origine. Le studio n'a pas de compte ni de mot de passe : avec `--reseau`, il est ouvert à tout ton réseau local, pas plus.

## Tests

```bash
npm test          # avec un vrai Redis jetable si redis-server est installé (sinon, ces tests sont passés)
npm run verifier  # TypeScript
```
