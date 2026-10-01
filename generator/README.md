# Générateur d'intro (prototype n°2)

Écrit, fait lire et illustre l'intro « grotte pirate » de bout en bout sur ton PC, puis l'assemble dans une page à ouvrir dans le navigateur. Rien ne sort de ta machine et rien n'est payant.

| Étape | Outil | Où ça tourne |
|---|---|---|
| Texte et choix des bruitages | Ollama, modèle `mistral-small3.2` | Carte graphique |
| Voix | Chatterbox ou Pocket TTS, via un serveur de voix local (voir `voix/README.md`) | Processeur |
| Image | ComfyUI, FLUX.2 [klein] 4B ou Z-Image Turbo | Carte graphique |
| Lecture | Le lecteur du prototype n°1 | Navigateur |

## Installation (une seule fois)

1. **Node.js 22.18 ou plus récent** (24 conseillé). Le générateur n'a aucune dépendance : rien d'autre à installer pour le lancer.
2. **Ollama** et le modèle de texte :
   ```bash
   ollama pull mistral-small3.2
   ```
   Il pèse environ 15 Go et tient dans les 20 Go de la RX 7900 XT, qu'Ollama prend en charge sous Windows comme sous Linux. Plus léger : `gemma4:12b`.
3. **Un serveur de voix** sur le port 8001 (le 8000 est celui de ComfyUI Desktop) : Chatterbox pour une voix expressive, ou Pocket TTS pour une voix légère. L'installation de chacun est décrite dans `voix/README.md`.
4. **ComfyUI**. Sous Windows, ComfyUI Desktop prend officiellement en charge les cartes AMD (ROCm). Sous Linux, utilise l'installation manuelle avec PyTorch pour ROCm. Ensuite :
   1. ouvre le modèle de workflow (« Templates ») FLUX.2 [klein] 4B ou Z-Image Turbo, et laisse ComfyUI télécharger les fichiers ;
   2. dans la zone du prompt positif, écris exactement `{{PROMPT}}` ;
   3. choisis un format large, par exemple 1344 × 832 ;
   4. dans le menu Workflow, choisis « Export (API) » et enregistre le fichier sous `generator/workflow-image.json`.

## Lancer

Ollama, Pocket TTS et ComfyUI doivent tourner. Puis, dans le dossier `generator` :

```bash
npm run generer
npm run generer -- --age 3-5
npm run generer -- --age 9-12 --idee "un perroquet qui garde un secret"
npm run generer -- --sans-image    # tant que ComfyUI n'est pas prêt
```

À la fin, le chemin de la page s'affiche : ouvre-la dans ton navigateur. Le dossier contient aussi la scène (`scene.json`), les voix (`voix/`), l'image et le prompt utilisé, pour comparer les essais.

Toutes les options : `npm run generer -- --aide`.

Pour réécouter le même texte avec une autre voix, reprends sa scène au lieu d'en écrire une nouvelle : `npm run generer -- --scene scenes/navire-endormi.json` (ou le `scene.json` d'un essai précédent). Avec plusieurs `--tts`, chaque voix lit le même texte et tu peux les comparer à l'aveugle : voir `voix/README.md`. Si ComfyUI n'est pas sur le port 8000 (installation manuelle : 8188), ajoute `--comfy http://127.0.0.1:8188`.

## Ce que fait la chaîne

1. **Texte.** Le modèle écrit l'intro en JSON, au format imposé par un schéma : un titre, une accroche, puis des segments. Pour chaque segment, il choisit un bruitage dans une liste fermée : goutte, vague, grincement, révélation du bateau, lanterne ou cloche.
2. **Mise en son.** Le code applique les règles : une seule révélation, au segment où le bateau apparaît ; la lanterne après la révélation ; la cloche à la fin ; au plus un bruitage tous les deux segments.
3. **Garde-fous.** Le ton et la longueur des phrases dépendent de l'âge. Si un mot à éviter pour cet âge apparaît, le modèle réécrit le texte. Le souhait de l'auditeur est traité comme une idée d'histoire, jamais comme une consigne. Ce n'est pas encore la vraie modération, où un second modèle relira chaque histoire : elle viendra avec la chaîne complète.
4. **Mémoire vidéo.** Le modèle de texte est déchargé dès qu'il a fini, pour laisser la place au modèle d'image. Pendant ce temps, le processeur génère la voix.
5. **Assemblage.** Une seule page HTML contient le lecteur, la scène, les voix et l'image.

## Limites de ce prototype

- Un seul décor, la grotte pirate : ce sont les sons et les animations que le lecteur sait jouer. Les autres thèmes viendront avec la bibliothèque de sons.
- Sur l'image générée, seules l'eau et la lumière s'animent. Règle la hauteur de l'eau dans la page, ou avec `--ligne-eau`.
- Les voix sont en WAV : une intro pèse 1 à 3 Mo. Les histoires longues passeront à un format compressé.

## Tests

```bash
npm install       # outils de développement : TypeScript et types Node
npm test          # chaîne complète contre de faux Ollama, Pocket TTS et ComfyUI
npm run verifier  # vérification des types
```
