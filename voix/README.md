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
4. Coupe les blancs au début et à la fin, puis enregistre sous `voix/references/conteur.wav`.

Ce texte est original, et sa transcription exacte est fournie, ce qui rend le clonage plus fidèle. Évite les textes célèbres (poèmes, chansons) : le modèle a tendance à les continuer au lieu de lire ta phrase. N'utilise jamais la voix de quelqu'un sans son accord.

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

Au premier lancement, les poids du modèle se téléchargent (quelques gigaoctets). Attends « Voix prête » : le générateur l'utilise ensuite sans option supplémentaire. Ctrl+C l'arrête, et la même commande le relance.

Réglages utiles :

| Option | Effet |
|---|---|
| `--style "(warm storyteller, calm and slow)"` | Consigne de ton ajoutée devant chaque phrase. Essaie aussi « (soft, mysterious whisper) ». |
| `--etapes 16` | Meilleure qualité, plus lent (défaut 10) |
| `--cfg 2.5` | Suit plus fidèlement la voix et le style (défaut 2.0) |

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

- Elle finit par `False` : PyTorch ne voit toujours pas la carte (voir ci-dessous). Supprime le dossier `.venv-gpu` et reste sur le processeur.

### Si PyTorch ne voit pas la carte (« Failed to get device count », « No HIP GPUs are available »)

Ces messages viennent de HIP, la couche d'AMD sous PyTorch : elle ne trouve aucune carte. Sous Windows, c'est un défaut connu de HIP 7, avec le même message ([ROCm/HIP#3899](https://github.com/ROCm/HIP/issues/3899)), et ROCm 10 ne le corrige pas toujours ([TheRock#8461](https://github.com/ROCm/TheRock/issues/8461)).

Si une application de Pinokio (Wan 2.2, ComfyUI…) utilise déjà ta carte, une version de PyTorch marche chez toi. Pour la retrouver :

```bash
py -3.12 voix/diagnostic_gpu.py
```

Le script interroge chaque environnement Python de Pinokio et du projet, sans rien modifier. Il dit lequel voit la carte, avec quelle version de PyTorch, et d'où elle vient. Si Pinokio n'est pas trouvé, ajoute `--pinokio` suivi de son dossier.

Sinon : pilote AMD Software Adrenalin à jour puis redémarrage, ou WSL2 (Linux dans Windows), où PyTorch pour cartes AMD est plus éprouvé.

Dans tous les cas, le serveur de voix continue de fonctionner : il repasse tout seul sur le processeur.

### Les messages « Badcase detected… retrying »

VoxCPM2 recommence une phrase quand l'audio dure plus de N fois le texte : c'est son garde-fou contre une voix qui s'emballe. Le seuil d'origine (6) déclenche à tort sur une narration posée de conteur. Le serveur le relève à 10 ; règle-le avec `--seuil-reprise` si besoin.

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

Le serveur répond par un simple son, de la durée du texte. Pratique pour vérifier que le générateur, le port et la page fonctionnent.

## Comparer des voix à l'aveugle

Lance deux moteurs sur deux ports, par exemple VoxCPM2 sur 8001 et Chatterbox avec `--port 8002`. Puis, dans `generator` :

```powershell
npm run generer -- --scene scenes/navire-endormi.json --sans-image --tts http://localhost:8001 --tts http://localhost:8002
```

Chaque voix lit le même texte. Tu obtiens une page par voix (`voix-A.html`, `voix-B.html`), avec des lettres tirées au sort. Écoute, choisis, et seulement ensuite ouvre `correspondance.txt` pour savoir quel moteur se cache derrière chaque lettre.
