# Démarrer sous Windows

Ce guide part de zéro : récupérer le projet sur ton PC, ouvrir le lecteur, faire tourner le générateur avec Ollama, la voix et Wan 2.2 (ou ComfyUI), puis lancer l'application Storia (partie 5).

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

## 5. L'application Storia (le studio)

Le studio sert l'application à ton navigateur, sur le PC ou sur une tablette. Il range les histoires dans la bibliothèque et fabrique celles qu'on lui demande, une à la fois, dans une file d'attente. Cette file vit dans **Redis**.

### Redis (une seule fois)

Choisis une des deux façons :

- **Avec Docker Desktop** (le plus simple si tu l'as déjà) :

  ```powershell
  docker run -d --name storia-redis -p 6379:6379 --restart unless-stopped redis:7-alpine
  ```

  Redis redémarre ensuite tout seul avec Docker Desktop.

- **Avec WSL** (Ubuntu dans Windows) :

  ```powershell
  wsl --install -d Ubuntu
  ```

  Redémarre le PC si on te le demande. Ensuite, dans le terminal Ubuntu :

  ```bash
  sudo apt update && sudo apt install -y redis-server
  sudo service redis-server start
  ```

  Windows le joint sur `localhost:6379`. Après un redémarrage du PC, relance seulement la dernière commande.

Redis ne garde que la file de création. Les histoires sont rangées ailleurs, dans `serveur/bibliotheque` : tu peux vider Redis sans rien perdre.

### Installer le studio et compiler l'application (une seule fois)

```powershell
cd $HOME/Documents/storia/serveur
npm install
cd ../app
flutter pub get
flutter build web --no-web-resources-cdn
```

Il faut Flutter 3.32 ou plus récent. Si `flutter pub get` se plaint d'une version, lance `flutter upgrade`. Recompile l'application (dernière commande) après chaque `git pull` qui la modifie.

### Lancer

Une fenêtre par service, comme pour le générateur :

1. **Ollama** tourne déjà.
2. **La voix**, dans le dossier du projet (le détail est dans `voix/README.md`) :

   ```powershell
   ./.venv-voxcpm/Scripts/python voix/serveur_voix.py --voix-ref voix/references/<ton-extrait>.wav --voix-ref-texte voix/texte-de-reference.txt
   ```

   Attends « Voix prête ».
3. **Wan 2.2** : rien à lancer, le studio s'en sert sans son interface. Ne génère rien dans l'interface de Pinokio pendant qu'une histoire se fabrique : la carte graphique ne peut pas tout porter à la fois.
4. **Le studio** :

   ```powershell
   cd $HOME/Documents/storia/serveur
   npm start
   ```

Ouvre <http://localhost:3000>. Le studio affiche au démarrage ce qui est prêt (✓) et ce qui manque (✗).

Pour la **tablette** ou le **téléphone**, sur le même Wi-Fi : lance `npm start -- --reseau` et tape sur la tablette l'adresse qu'il affiche (par exemple `http://192.168.1.20:3000`). La première fois, Windows demande d'autoriser Node.js sur le réseau : accepte pour les **réseaux privés**.

### Retrouver les histoires déjà générées

Les histoires faites avec le générateur (`generator/sorties`) entrent dans la bibliothèque avec :

```powershell
cd $HOME/Documents/storia/serveur
npm run importer
```

### Essayer sans les modèles

`npm run demo` lance le studio avec un faux conteur rapide, sans voix ni image. Il faut seulement Redis. Pratique pour découvrir l'application, ou pour la modifier sans faire chauffer la carte graphique. Ses histoires sont rangées à part, dans `serveur/bibliotheque-demo`.

## En cas de souci

| Message | Solution |
|---|---|
| `Ollama ne répond pas` | Lance Ollama depuis le menu Démarrer. |
| `Le modèle « … » n'est pas installé` | `ollama pull mistral-small3.2` |
| `… ne répond pas sur http://localhost:8001` | La fenêtre de la voix est fermée, ou le moteur n'a pas fini de démarrer. |
| `ComfyUI ne répond pas` | Lance ComfyUI Desktop. S'il n'utilise pas le port 8000 (voir ses réglages), ajoute `--comfy http://127.0.0.1:<port>`. |
| `Workflow d'image introuvable` | Refais l'étape « Export (API) », ou lance avec `--sans-image`. |
| PowerShell refuse de lancer un script (`npm.ps1`) | Une seule fois : `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Redis ne répond pas sur redis://127.0.0.1:6379` | Lance Redis : Docker Desktop (le conteneur `storia-redis`), ou `sudo service redis-server start` dans Ubuntu. |
| `Le port 3000 est déjà pris` | Un studio tourne déjà dans une autre fenêtre, sinon : `npm start -- --port 3001`. |
| La page dit « Il manque seulement l'application » | Compile-la : `cd app` puis `flutter build web --no-web-resources-cdn`. |
| La tablette n'arrive pas à se connecter | Lance avec `--reseau`, vérifie qu'elle est sur le même Wi-Fi, et autorise Node.js dans le pare-feu de Windows (réseaux privés). |
| L'atelier affiche « En pause » | Il attend un service : son message dit lequel lancer (Ollama ou la voix). L'histoire repart seule. |
