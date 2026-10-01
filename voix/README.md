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

Au premier lancement, les poids du modèle se téléchargent (quelques gigaoctets). Le générateur l'utilise ensuite sans option supplémentaire.

Réglages utiles :

| Option | Effet |
|---|---|
| `--style "(warm storyteller, calm and slow)"` | Consigne de ton ajoutée devant chaque phrase. Essaie aussi « (soft, mysterious whisper) ». |
| `--etapes 16` | Meilleure qualité, plus lent (défaut 10) |
| `--cfg 2.5` | Suit plus fidèlement la voix et le style (défaut 2.0) |

### Sur la carte graphique AMD

Sans rien d'autre, VoxCPM2 tourne sur le processeur : la voix met alors plus de temps à se générer qu'à s'écouter. Pour utiliser la RX 7900 XT, installe PyTorch pour cartes AMD dans le même environnement :

1. Mets à jour le pilote AMD Adrenalin.
2. Ouvre la page officielle d'AMD, « Install PyTorch for Radeon on Windows » : <https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/install/installrad/windows/install-pytorch.html>
3. Retire la version pour processeur : `./.venv-voxcpm/Scripts/python -m pip uninstall -y torch torchaudio`
4. Lance la commande d'installation de la page AMD pour Python 3.12, en remplaçant `python` par `./.venv-voxcpm/Scripts/python`. Installe tous les fichiers proposés **en une seule commande**, sinon pip remet la version pour processeur.

Au lancement, le serveur affiche alors « Carte graphique : AMD Radeon RX 7900 XT ». Si la carte ne répond pas, il le dit et repasse sur le processeur.

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
