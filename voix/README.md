# Voix

Le générateur envoie chaque phrase à un **serveur de voix** local (port 8001). Tous les moteurs parlent le même langage : on change de voix en changeant de moteur, sans toucher au générateur.

## Quel moteur ?

Un test d'écoute à l'aveugle en français, avec 12 auditeurs et des voix de narration, a comparé les modèles open source en 2026 ([benchmark-tts](https://github.com/chvalois/benchmark-tts)). Sa note de naturel, sur 5, est le meilleur indicateur disponible :

| Moteur | Naturel | Licence | Sur ton PC |
|---|---|---|---|
| ElevenLabs v3 (payant, pour référence) | 4,22 | Propriétaire | En ligne seulement |
| **FireRedTTS3** | **4,11** | Apache 2.0 | Carte graphique seulement (environ 17 Go). Installation délicate sous Windows avec une carte AMD : prochaine étape, si tu le valides à l'écoute. |
| **VoxCPM2** | 3,19 | Apache 2.0 | **Intégré.** Processeur ou carte graphique (environ 10 Go). Style réglable. À essayer en premier. |
| Chatterbox V3 | 3,00 | MIT | Intégré. Processeur ou carte graphique (environ 6,5 Go). Un accent a été relevé par les auditeurs. |
| Pocket TTS | Non classé | Code MIT, poids CC-BY 4.0 | Processeur. Léger mais peu expressif. |

FireRedTTS3 se détache nettement. Entre VoxCPM2 et Chatterbox, l'écart reste dans la marge d'erreur du test.

## Écouter avant d'installer

- FireRedTTS3 : extraits sur <https://fireredteam.github.io/demos/firered_tts_3/>
- VoxCPM2 : démo en ligne sur <https://huggingface.co/spaces/OpenBMB/VoxCPM-Demo> (tape ton texte en français, et tu peux y déposer un extrait de voix)
- Chatterbox : démo en ligne sur <https://huggingface.co/spaces/ResembleAI/Chatterbox-Multilingual-TTS>

Pour comparer, fais lire les phrases de l'intro : « Au fond d'une grotte secrète… là où la mer chante tout bas… dormait un bateau pirate que personne n'avait vu depuis cent ans. Jusqu'à cette nuit. »

## Enregistrer la voix du conteur

Les moteurs imitent la voix d'un court extrait. Sans extrait, la voix change d'une phrase à l'autre (VoxCPM2) ou garde un accent anglais (Chatterbox).

1. Crée le dossier : `mkdir voix/references`. Il n'est jamais envoyé sur GitHub.
2. Dans l'Enregistreur audio de Windows, choisis le format WAV dans les paramètres.
3. Lis le texte de `voix/texte-de-reference.txt`, environ 25 secondes, comme si tu le racontais à un enfant : posé, chaleureux, avec la question et la réponse murmurée. Pièce calme, micro à 20 ou 30 cm, sans musique.
4. Coupe les blancs au début et à la fin, puis enregistre sous `voix/references/conteur.wav`. Un MP3 marche aussi : remplace alors `.wav` par `.mp3` dans les commandes.

Ce texte est original, et sa transcription exacte est fournie, ce qui rend le clonage plus fidèle. Évite les textes célèbres (poèmes, chansons) : le modèle a tendance à les continuer au lieu de lire ta phrase. N'utilise jamais la voix de quelqu'un sans son accord.

Pas envie d'enregistrer ? VoxCPM2 peut aussi inventer une voix : voir « Créer une voix sans l'enregistrer » plus bas.

Toutes les commandes suivantes se tapent dans PowerShell, depuis le dossier du projet (`cd $HOME/Documents/storia`). Elles marchent aussi dans Git Bash, car les chemins utilisent des barres `/`. Chaque moteur a son propre environnement Python (dossier `.venv-…`), pour éviter les conflits de versions.

## VoxCPM2, le moteur par défaut

Installation, une seule fois :

```powershell
py -3.12 -m venv .venv-voxcpm
./.venv-voxcpm/Scripts/python -m pip install --upgrade pip
./.venv-voxcpm/Scripts/python -m pip install voxcpm
```

Lancement :

```powershell
./.venv-voxcpm/Scripts/python voix/serveur_voix.py --voix-ref voix/references/conteur.wav --voix-ref-texte voix/texte-de-reference.txt
```

Avec un MP3, remplace `.wav` par `.mp3`. Au premier lancement, les poids de VoxCPM2 et de Whisper se téléchargent (quelques gigaoctets). Le serveur fait ensuite une lecture d'essai, le « préchauffage », puis affiche « Voix prête » : le générateur l'utilise alors sans option supplémentaire. Ctrl+C l'arrête, et la même commande le relance.

### Ce que fait le serveur pour chaque histoire

1. **Il lit chaque phrase d'un seul souffle.** Le générateur découpe le texte en segments, pour caler les bruitages : « dormait un bateau pirate » puis « que personne n'avait vu depuis cent ans. ». Lus séparément, ces morceaux sonnent faux, chacun avec une intonation de fin de phrase. Le serveur lit donc la phrase entière, puis la recoupe dans ses silences. Les pauses du lecteur suivent ce rythme.
2. **Il vérifie chaque lecture.** Whisper, un modèle de reconnaissance vocale, réécoute la phrase. Une phrase sautée, tronquée, bredouillée, beaucoup trop longue ou coupée d'un long silence est relue, trois fois au plus. Le générateur affiche le score de chaque phrase (« relue à 97 % ») et signale celles qui restent douteuses dans `voix/rapport.json`.
3. **Il met la voix à niveau constant**, d'une phrase à l'autre, et retire les blancs du début et de la fin.

La transcription donnée par `--voix-ref-texte` rend l'imitation plus fidèle, mais seulement si elle colle mot à mot à l'enregistrement : sinon, VoxCPM2 se perd, saute des phrases ou en lit d'autres. Le serveur la vérifie donc avec Whisper au démarrage. Si elle ne colle pas, il affiche ce qu'il a entendu et imite la voix sans elle.

Réglages utiles :

| Option | Effet |
|---|---|
| `--style "(warm storyteller, calm and slow)"` | Consigne de ton ajoutée devant chaque phrase. Essaie aussi « (soft, mysterious whisper) ». |
| `--etapes 16` | Meilleure qualité, plus lent (défaut 10) |
| `--cfg 2.5` | Suit plus fidèlement la voix et le style (défaut 2.0) |
| `--essais 5` | Lectures au plus pour une phrase ratée (défaut 3) |
| `--relecture aucune` | Sans Whisper : les lectures ne sont plus jugées que sur leur durée |

### Créer une voix sans l'enregistrer

VoxCPM2 sait inventer une voix d'après une description. Le serveur lui fait lire le texte de référence avec cette voix, une seule fois, et garde l'enregistrement : toutes les phrases reprennent ensuite ce timbre. C'est une voix de synthèse, qui n'imite personne.

```bash
./.venv-voxcpm/Scripts/python voix/serveur_voix.py --voix-ref voix/references/conteur-ia.wav --creer-voix "A warm, deep male storyteller voice, calm and gentle"
```

Écoute `voix/references/conteur-ia.wav`. Si la voix ne te plaît pas, supprime le fichier et relance : chaque création donne une voix différente. Relancée telle quelle, la commande réutilise la voix déjà créée ; change le nom du fichier pour en garder plusieurs. Écris la description en anglais, comme dans les exemples de VoxCPM2 :

- `A soft, warm female storyteller voice, gentle and expressive, slow pace`
- `An elderly man with a kind, slightly husky voice, telling a bedtime story`

### Sur la carte graphique AMD

Sans rien d'autre, VoxCPM2 tourne sur le processeur : environ 2 minutes par phrase. La carte graphique est bien plus rapide, mais PyTorch pour cartes AMD est encore jeune sous Windows. On l'essaie donc dans un environnement à part, `.venv-gpu` : si la carte n'y répond pas, tu supprimes ce dossier, et ton installation qui marche n'a pas bougé. Tu peux l'installer pendant que l'autre serveur tourne.

1. Mets à jour le pilote **AMD Software Adrenalin**, puis redémarre le PC.
2. Installe PyTorch pour ta carte (ROCm 10, environ 1,1 Go à télécharger) :

```bash
py -3.12 -m venv .venv-gpu
./.venv-gpu/Scripts/python -m pip install --upgrade pip
./.venv-gpu/Scripts/python -m pip install --index-url https://stable.repo.amd.com/rocm/whl-next/ "torch[device-gfx1100]" "torchvision[device-gfx1100]" torchaudio
```

`gfx1100` désigne les RX 7900 XT et XTX. Pour une autre carte, cherche son code dans le tableau « Supported Python [device-*] install extras » de <https://github.com/ROCm/TheRock/blob/main/RELEASES.md>, d'où vient cette commande.

3. Vérifie :

```bash
./.venv-gpu/Scripts/python -c "import platform, torch; print(platform.platform(), torch.__version__, torch.cuda.is_available())"
```

- La ligne finit par `True` : la carte répond. Installe VoxCPM2 dans cet environnement, arrête l'ancien serveur (Ctrl+C), puis lance celui-ci. Il affiche « Carte graphique : AMD Radeon RX 7900 XT ».

```bash
./.venv-gpu/Scripts/python -m pip install voxcpm
./.venv-gpu/Scripts/python voix/serveur_voix.py --voix-ref voix/references/conteur.wav --voix-ref-texte voix/texte-de-reference.txt
```

- Elle finit par `False` : PyTorch ne voit pas la carte, voir ci-dessous.

Une version précédente de ce guide installait PyTorch pour AMD (ROCm 7.2.1) directement dans `.venv-voxcpm`. Si tu l'as fait, cette installation marche aussi, et `.venv-gpu` est inutile.

### Si PyTorch ne voit pas la carte (« Failed to get device count », « No HIP GPUs are available »)

Lance le diagnostic. Il ne modifie rien :

```bash
py -3.12 voix/diagnostic_gpu.py
```

Il interroge chaque environnement Python du projet et de Pinokio : version de PyTorch, carte vue ou non, origine de l'installation. Si Pinokio n'est pas trouvé, ajoute `--pinokio` suivi de son dossier.

- **La carte n'apparaît que « Sans HIP_VISIBLE_DEVICES »** : cette variable de Windows la masque. `HIP_VISIBLE_DEVICES=1` sert quand la carte graphique intégrée au Ryzen est active : elle désigne alors la deuxième carte, la RX 7900 XT. Une fois la carte intégrée désactivée, il ne reste qu'une carte, numérotée 0, et la variable la cache. Supprime-la : menu Démarrer, « Modifier les variables d'environnement système », bouton « Variables d'environnement… », sélectionne `HIP_VISIBLE_DEVICES` (dans l'une des deux listes), « Supprimer », puis OK. Ferme et rouvre ensuite tes terminaux et Pinokio. Laisse la carte intégrée désactivée.
- **Aucun environnement ne voit la carte** : mets à jour le pilote AMD Software Adrenalin et redémarre le PC. Sous Windows, HIP 7 a aussi un défaut connu qui donne ces messages ([ROCm/HIP#3899](https://github.com/ROCm/HIP/issues/3899), [TheRock#8461](https://github.com/ROCm/TheRock/issues/8461)). En dernier recours : WSL2 (Linux dans Windows).

Dans tous les cas, le serveur de voix continue de fonctionner : il repasse tout seul sur le processeur.

### Une lecture coupée trop longue

VoxCPM2 coupe une lecture qui dépasse six fois la longueur normale de son texte : c'est le signe qu'elle s'emballe, et le serveur la recommence. Une version précédente relevait ce plafond à 10, à tort. Une narration normale reste loin en dessous, même lente.

### Sur carte AMD, des lectures lentes

Pour chaque nouvelle longueur de phrase, la bibliothèque de calcul d'AMD (MIOpen) peut chercher longuement la meilleure façon de calculer. Le serveur règle `MIOPEN_FIND_MODE=FAST` pour l'éviter. Le préchauffage au démarrage absorbe la toute première lecture, la plus lente.

## Chatterbox, l'alternative

```powershell
py -3.12 -m venv .venv-chatterbox
./.venv-chatterbox/Scripts/python -m pip install --upgrade pip
./.venv-chatterbox/Scripts/python -m pip install git+https://github.com/resemble-ai/chatterbox.git
./.venv-chatterbox/Scripts/python voix/serveur_voix.py --moteur chatterbox --voix-ref voix/references/conteur.wav
```

Réglages : `--expressivite` de 0.25 (neutre) à 1.0 (théâtral), 0.6 par défaut ; `--cfg` plus bas pour un débit plus posé, 0.4 par défaut. Chatterbox impose PyTorch 2.6 : il reste sur le processeur sous Windows.

## Pocket TTS, la voix légère

```powershell
py -3.12 -m venv .venv-pocket
./.venv-pocket/Scripts/python -m pip install pocket-tts
./.venv-pocket/Scripts/pocket-tts serve --language french --port 8001
```

## Vérifier l'installation sans modèle

```powershell
py -3.12 voix/serveur_voix.py --moteur test
```

Le serveur répond par un bip par mot, avec des blancs aux virgules, comme une voix. Pratique pour vérifier que le générateur, le port, la découpe des phrases et la page fonctionnent. Les tests du serveur se lancent avec `./.venv-voxcpm/Scripts/python -m unittest discover voix`.

## Comparer des voix à l'aveugle

Lance deux moteurs sur deux ports, par exemple VoxCPM2 sur 8001 et Chatterbox avec `--port 8002`. Puis, dans `generator` :

```powershell
npm run generer -- --scene scenes/navire-endormi.json --sans-image --tts http://localhost:8001 --tts http://localhost:8002
```

Chaque voix lit le même texte. Tu obtiens une page par voix (`voix-A.html`, `voix-B.html`), avec des lettres tirées au sort. Écoute, choisis, et seulement ensuite ouvre `correspondance.txt` pour savoir quel moteur se cache derrière chaque lettre.
