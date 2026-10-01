# Voix

Le générateur envoie chaque phrase à un **serveur de voix** local (port 8001 par défaut). Tous les moteurs parlent le même langage : on change de voix en changeant de serveur, sans toucher au générateur.

| Moteur | Licence | Points forts | Limites |
|---|---|---|---|
| **Chatterbox Multilingual V3** (Resemble AI) | MIT : usage commercial possible | Expressif, expressivité réglable, imite une voix à partir de 10 à 20 secondes, filigrane inaudible sur chaque son (marquage IA) | Plus lent sur le processeur |
| **Pocket TTS** (Kyutai) | Code MIT, poids CC-BY 4.0 | Léger et rapide, même sur le processeur | Peu expressif |

Toutes les commandes se tapent dans PowerShell, depuis le dossier du projet (`cd $HOME\Documents\storia`). Chaque moteur a son propre environnement Python, dans un dossier `.venv-…`, pour éviter les conflits de versions.

## Chatterbox : la voix expressive

Installation, une seule fois (Git doit être installé) :

```powershell
py -3.12 -m venv .venv-chatterbox
.\.venv-chatterbox\Scripts\python -m pip install --upgrade pip
.\.venv-chatterbox\Scripts\python -m pip install git+https://github.com/resemble-ai/chatterbox.git
```

Lancement :

```powershell
.\.venv-chatterbox\Scripts\python voix\serveur_voix.py --voix-ref voix\references\conteur.wav
```

Au premier lancement, les poids du modèle se téléchargent (quelques gigaoctets). Ensuite, le générateur l'utilise sans option supplémentaire.

### La voix de référence

Chatterbox imite la voix d'un court extrait. Sans extrait, il prend sa voix intégrée, qui est anglaise, et le français garde un accent : **fournis un extrait français**.

- 10 à 20 secondes de parole claire, sans musique ni bruit de fond, avec le ton voulu : un conteur chaleureux et posé.
- Le plus simple est ta propre voix. L'Enregistreur audio de Windows convient : dans ses paramètres, choisis le format WAV ou MP3. Lis un passage d'histoire comme tu le raconterais à un enfant.
- Range le fichier dans `voix\references\` (crée-le avec `mkdir voix\references`). Ce dossier n'est jamais envoyé sur GitHub.
- N'utilise jamais la voix de quelqu'un sans son accord.

### Réglages

| Option | Effet | Défaut |
|---|---|---|
| `--expressivite` | De 0.25 (neutre) à 1.0 (très théâtral) | 0.6 |
| `--cfg` | Plus bas, débit plus posé ; à 0, l'accent de l'extrait compte moins | 0.4 |
| `--temperature` | Variété d'une lecture à l'autre | 0.8 |
| `--port` | Port du serveur | 8001 |

Pour un conte lu de façon plus vivante : `--expressivite 0.7 --cfg 0.3`.

Sur le processeur, générer la voix prend plus de temps que de l'écouter. C'est suffisant pour comparer les voix et préparer des histoires à l'avance. Pour la lecture en direct, il faudra passer par la carte graphique : ce sera l'étape suivante, une fois la voix choisie.

## Pocket TTS : la voix légère

```powershell
py -3.12 -m venv .venv-pocket
.\.venv-pocket\Scripts\python -m pip install pocket-tts
.\.venv-pocket\Scripts\pocket-tts serve --language french --port 8001
```

Avec `--language french_24l`, la qualité est meilleure mais la génération plus lente.

## Vérifier l'installation sans modèle

```powershell
py -3.12 voix\serveur_voix.py --moteur test
```

Le serveur répond par un simple son, de la durée du texte. Pratique pour vérifier que le générateur, le port et la page fonctionnent.

## Comparer des voix à l'aveugle

Lance deux moteurs sur deux ports, par exemple Chatterbox sur 8001 et Pocket TTS sur 8002. Puis, dans `generator` :

```powershell
npm run generer -- --scene scenes/navire-endormi.json --sans-image --tts http://localhost:8001 --tts http://localhost:8002
```

Le même texte est lu par chaque voix. Tu obtiens une page par voix (`voix-A.html`, `voix-B.html`), dont les lettres sont tirées au sort. Écoute-les, choisis, et seulement ensuite ouvre `correspondance.txt` pour savoir quel moteur se cache derrière chaque lettre.
