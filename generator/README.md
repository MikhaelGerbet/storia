# Générateur d'intro (prototype n°2)

Écrit, fait lire et illustre l'intro « grotte pirate » de bout en bout sur ton PC, puis l'assemble dans une page à ouvrir dans le navigateur. Rien ne sort de ta machine et rien n'est payant.

| Étape | Outil | Où ça tourne |
|---|---|---|
| Texte et choix des bruitages | Ollama, modèle `mistral-small3.2` | Carte graphique |
| Voix | VoxCPM2 (ou Chatterbox, Pocket TTS) via un serveur de voix local : voir `voix/README.md` | Carte graphique ou processeur |
| Image et animation en boucle | Wan2GP, déjà dans Pinokio : Z-Image Turbo pour l'image, Wan 2.2 pour l'animer | Carte graphique |
| Image seule (autre voie) | ComfyUI, FLUX.2 [klein] 4B ou Z-Image Turbo | Carte graphique |
| Lecture | Le lecteur du prototype n°1 | Navigateur |

## Installation (une seule fois)

1. **Node.js 22.18 ou plus récent** (24 conseillé). Le générateur n'a aucune dépendance : rien d'autre à installer pour le lancer.
2. **Ollama** et le modèle de texte :
   ```bash
   ollama pull mistral-small3.2
   ```
   Il pèse environ 15 Go et tient dans les 20 Go de la RX 7900 XT, qu'Ollama prend en charge sous Windows comme sous Linux. Plus léger : `gemma4:12b`.
3. **Un serveur de voix** sur le port 8001 (le 8000 est celui de ComfyUI Desktop) : VoxCPM2 par défaut, ou Chatterbox, ou Pocket TTS. L'installation de chacun est décrite dans `voix/README.md`.
4. **ComfyUI**. Sous Windows, ComfyUI Desktop prend officiellement en charge les cartes AMD (ROCm). Sous Linux, utilise l'installation manuelle avec PyTorch pour ROCm. Ensuite :
   1. ouvre le modèle de workflow (« Templates ») FLUX.2 [klein] 4B ou Z-Image Turbo, et laisse ComfyUI télécharger les fichiers ;
   2. dans la zone du prompt positif, écris exactement `{{PROMPT}}` ;
   3. choisis un format large, par exemple 1344 × 832 ;
   4. dans le menu Workflow, choisis « Export (API) » et enregistre le fichier sous `generator/workflow-image.json`.

## Image et animation avec Wan 2.2 (Pinokio)

Avec `--wan`, le générateur se sert de Wan2GP, l'application « Wan 2.2 » de Pinokio, sans passer par son interface :

1. **L'image** : Z-Image Turbo la dessine en 1280 × 720, d'après le décor de l'histoire.
2. **L'animation** : Wan 2.2 anime cette image pendant 5 secondes, en partant d'elle et en revenant à elle (même image au début et à la fin). La vidéo boucle donc sur elle-même, et le lecteur masque le raccord par un fondu.

```bash
npm run generer -- --scene scenes/navire-endormi.json --wan
npm run generer -- --scene scenes/navire-endormi.json --wan --image mon-image.png   # anime ton image
```

- Si le gardien de la carte graphique tourne (`gardien/`), le générateur lui réserve la carte avant de commencer : il attend qu'Oula ou une histoire du studio ait fini, et s'arrête si un jeu démarre. `--sans-gardien` pour s'en passer.
- Wan2GP est cherché dans `C:/pinokio/api`. S'il est ailleurs : `--wan-dossier C:/chemin/vers/app`, le dossier qui contient `wgp.py`. Sa version doit être 9.82 ou plus récente. Sinon, mets-le à jour dans Pinokio.
- Au premier usage, Wan2GP télécharge les modèles qui lui manquent (plusieurs dizaines de Go pour Wan 2.2) et les accélérateurs « Lightning ». Sa progression s'affiche dans le terminal. Pour les mettre sur un autre disque : `--wan-modeles P:/wan-modeles`. Le générateur l'inscrit dans les réglages de Wan2GP (« Model Checkpoint Folders »), qui le garde : une fois suffit. Les modèles déjà téléchargés restent trouvés où ils sont.
- L'animation se fait en 4 étapes grâce aux accélérateurs. `--wan-etapes 30` donne la qualité d'origine, mais c'est bien plus lent. Compte plusieurs minutes dans tous les cas.
- L'interface de Wan dans Pinokio peut rester ouverte, mais ne lance rien dedans pendant ce temps : il n'y a qu'une carte graphique. Pour la même raison, le serveur de voix lui rend la sienne avant l'animation, puis recharge ses modèles à la lecture suivante.
- Autre modèle d'image : `--wan-image flux2_klein_4b`, ou `qwen_image_20B` (plus lent).
- Animation déjà faite ailleurs (MP4 ou WebM) : `--animation ma-boucle.mp4`.

Les réglages envoyés à Wan2GP et ses résultats sont rangés dans le dossier `wan/` de l'histoire. Pour refaire un essai à la main : `python wgp.py --process <réglages.json>`, depuis le dossier de Wan2GP.

## Lancer

Ollama, le serveur de voix et, pour l'image, ComfyUI ou Wan2GP doivent être en place. Puis, dans le dossier `generator` :

```bash
npm run generer
npm run generer -- --age 3-5
npm run generer -- --age 9-12 --idee "un perroquet qui garde un secret"
npm run generer -- --sans-image    # tant que ComfyUI n'est pas prêt
npm run generer -- --wan           # image et animation avec Wan 2.2
```

À la fin, le chemin de la page s'affiche : ouvre-la dans ton navigateur. Le dossier contient aussi la scène (`scene.json`), les voix (`voix/`), l'image et le prompt utilisé, pour comparer les essais.

Toutes les options : `npm run generer -- --aide`.

Pour réécouter le même texte avec une autre voix, reprends sa scène au lieu d'en écrire une nouvelle : `npm run generer -- --scene scenes/navire-endormi.json` (ou le `scene.json` d'un essai précédent). Avec plusieurs `--tts`, chaque voix lit le même texte et tu peux les comparer à l'aveugle : voir `voix/README.md`. Si ComfyUI n'est pas sur le port 8000 (installation manuelle : 8188), ajoute `--comfy http://127.0.0.1:8188`.

## Ce que fait la chaîne

1. **Texte.** Le modèle écrit l'intro en JSON, au format imposé par un schéma : un titre, une accroche, puis des segments. Pour chaque segment, il choisit un bruitage dans une liste fermée : goutte, vague, grincement, révélation du bateau, lanterne ou cloche.
2. **Mise en son.** Le code applique les règles : une seule révélation, au segment où le bateau apparaît ; la lanterne après la révélation ; la cloche à la fin ; au plus un bruitage tous les deux segments.
3. **Garde-fous.** Le ton et la longueur des phrases dépendent de l'âge. Si un mot à éviter pour cet âge apparaît, le modèle réécrit le texte. Le souhait de l'auditeur est traité comme une idée d'histoire, jamais comme une consigne. Ce n'est pas encore la vraie modération, où un second modèle relira chaque histoire : elle viendra avec la chaîne complète.
4. **Mémoire vidéo.** Le modèle de texte est déchargé dès qu'il a fini, pour laisser la place au modèle d'image. Avec Wan, tout se fait l'un après l'autre : la voix, puis l'image, puis l'animation.
5. **Voix.** Le serveur lit chaque phrase d'un seul souffle, fait vérifier chaque lecture par Whisper, puis la recoupe en segments. Le générateur reprend son rythme et enregistre son bilan dans `voix/rapport.json`.
6. **Assemblage.** Une seule page HTML contient le lecteur, la scène, les voix, l'image et l'animation.

## Limites de ce prototype

- Un seul décor, la grotte pirate : ce sont les sons et les animations que le lecteur sait jouer. Les autres thèmes viendront avec la bibliothèque de sons.
- Sans animation, sur une image générée par ComfyUI, seules l'eau et la lumière s'animent. Règle la hauteur de l'eau dans la page, ou avec `--ligne-eau`.
- Les voix sont en WAV : une intro pèse 1 à 3 Mo. Les histoires longues passeront à un format compressé.
- L'animation est intégrée à la page : quelques Mo de plus.

## Tests

```bash
npm install       # outils de développement : TypeScript et types Node
npm test          # chaîne complète contre de faux Ollama, serveur de voix, ComfyUI et Wan2GP
npm run verifier  # vérification des types
```
