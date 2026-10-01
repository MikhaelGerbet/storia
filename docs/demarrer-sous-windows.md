# Démarrer sous Windows

Ce guide part de zéro : récupérer le projet sur ton PC, ouvrir le lecteur, puis faire tourner le générateur avec Ollama, la voix et ComfyUI.

Toutes les commandes se tapent dans **PowerShell** (menu Démarrer, tape « PowerShell »). Elles marchent aussi dans **Git Bash** : les chemins y sont écrits avec des barres `/`, que les deux acceptent (Git Bash supprime les barres `\`). Quand une étape dit « dans le dossier du projet », commence par :

```powershell
cd $HOME/Documents/storia
```

## 1. Les outils (une seule fois)

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
```

Ferme puis rouvre PowerShell pour qu'il trouve les nouveaux outils. Vérifie avec `git --version`, `node --version` (22.18 ou plus) et `py -3.12 --version`.

Tu as déjà Ollama. Pour les images, installe **ComfyUI Desktop** depuis <https://www.comfy.org/download> : il prend en charge les cartes AMD sous Windows.

## 2. Récupérer le projet

```powershell
cd $HOME/Documents
git clone https://github.com/MikhaelGerbet/storia.git
cd storia
git checkout claude/story-generator-ai-audio-7xh2ng
```

Le projet est maintenant dans `Documents\storia`. Pour récupérer mes mises à jour plus tard, lance `git pull` dans ce dossier.

## 3. Le lecteur (prototype n°1)

Double-clique sur `Documents\storia\prototype\intro-pirate\index.html`. C'est la même page que celle que je t'ai envoyée.

## 4. Le générateur (prototype n°2)

Il faut trois services qui tournent en même temps, puis le générateur. Ouvre une fenêtre PowerShell par service et laisse-les ouvertes.

### Texte : Ollama

Ollama tourne déjà en arrière-plan (son icône est près de l'horloge). Une seule fois, télécharge le modèle :

```powershell
ollama pull mistral-small3.2
```

### Voix

Deux moteurs au choix, chacun dans son propre environnement Python (dossier `.venv-…` dans le projet). Un seul tourne sur le port 8001 à la fois ; le guide de chacun est dans `voix/README.md`.

- **VoxCPM2** : le moteur par défaut. Il imite la voix d'un extrait de 25 secondes (ta voix de conteur), et son style se règle. C'est celui à installer en premier.
- **Chatterbox** et **Pocket TTS** : des alternatives.

Avant d'installer quoi que ce soit, écoute les démos en ligne listées dans `voix/README.md`. Commence par enregistrer ta voix de conteur, comme expliqué au même endroit.

### Image et animation : Wan 2.2 (Pinokio)

Si Wan 2.2 tourne déjà dans Pinokio, il n'y a rien à installer : ajoute `--wan` au générateur. Il fabrique l'image, puis une animation de 5 secondes qui tourne en boucle. Le détail est dans `generator/README.md`.

### Image seule : ComfyUI Desktop

C'est l'autre voie, sans animation :

1. Lance ComfyUI Desktop.
2. Ouvre le modèle de workflow (« Templates ») **FLUX.2 [klein] 4B** et laisse ComfyUI télécharger les fichiers.
3. Dans la zone du prompt positif, écris exactement `{{PROMPT}}`.
4. Choisis un format large, par exemple 1344 × 832.
5. Menu Workflow, « Export (API) » : enregistre le fichier sous `Documents\storia\generator\workflow-image.json`.

### Lancer le générateur

```powershell
cd $HOME/Documents/storia/generator
npm run generer
```

À la fin, le chemin de la page générée s'affiche : ouvre-la dans ton navigateur. Variantes :

```powershell
npm run generer -- --age 3-5
npm run generer -- --idee "un perroquet qui garde un secret"
npm run generer -- --sans-image
npm run generer -- --wan
```

## En cas de souci

| Message | Solution |
|---|---|
| `Ollama ne répond pas` | Lance Ollama depuis le menu Démarrer. |
| `Le modèle « … » n'est pas installé` | `ollama pull mistral-small3.2` |
| `… ne répond pas sur http://localhost:8001` | La fenêtre de la voix est fermée, ou le moteur n'a pas fini de démarrer. |
| `ComfyUI ne répond pas` | Lance ComfyUI Desktop. S'il n'utilise pas le port 8000 (voir ses réglages), ajoute `--comfy http://127.0.0.1:<port>`. |
| `Workflow d'image introuvable` | Refais l'étape « Export (API) », ou lance avec `--sans-image`. |
| PowerShell refuse de lancer un script (`npm.ps1`) | Une seule fois : `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
