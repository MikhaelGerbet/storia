# Prototype n°1 : « Le Navire endormi »

L'intro d'une histoire de pirates, en une quinzaine de secondes : une voix, l'ambiance d'une grotte marine, des bruitages synchronisés et une illustration animée. Le but est de juger **l'expérience d'écoute** avant d'automatiser quoi que ce soit.

## Lancer

Ouvre `index.html` dans Chrome, Edge, Firefox ou Safari (double-clic). Aucune installation, aucun serveur. Mets un casque.

## Ce qui est réel et ce qui est provisoire

| Élément | Dans ce prototype | Dans l'application |
|---|---|---|
| Texte | 5 phrases écrites à la main | Généré par l'IA selon l'âge et le thème |
| Voix | Voix de synthèse du navigateur (**provisoire**) | Voix IA (Pocket TTS, Chatterbox, ou un service en ligne) |
| Ambiance et bruitages | Synthétisés en direct (Web Audio) : vagues, ressac, clapotis, gouttes, grincement, cloche, flamme | Bibliothèque de sons enregistrés libres de droits, choisis par l'IA dans une liste fermée |
| Musique | Nappe grave très discrète | Boucles par ambiance |
| Illustration | Peinte en code (**provisoire**) | Image générée par IA |
| Animation | Shader WebGL (eau, cascade, voiles, lumière, lanternes) et particules | Même technique, dans l'app |

## Le déroulé est une donnée

Tout ce qui se passe est décrit dans l'objet `SCENE`, en haut du script : les phrases, les pauses, et les repères comme « au début de la phrase 3, le bateau sort de l'ombre et le bois grince ». Le lecteur ne fait que jouer cette description. C'est l'embryon du format que l'IA produira pour chaque histoire.

Les bruitages tombent entre les phrases ou à un instant précis d'une phrase. La voix est jouée phrase par phrase, donc on connaît toujours le bon moment.

## Tester avec une vraie voix IA (gratuit)

Les 5 phrases à faire lire :

1. Au fond d'une grotte secrète…
2. là où la mer chante tout bas…
3. dormait un bateau pirate
4. que personne n'avait vu depuis cent ans.
5. Jusqu'à cette nuit.

Deux façons de fournir la voix :

- **Un fichier par phrase** : `1.wav` à `5.wav`. C'est le plus précis.
- **Un seul fichier** avec un vrai silence entre les phrases : le lecteur le coupe automatiquement aux silences.

Glisse ensuite les fichiers sur la page, ou ouvre « Tester avec ton image et ta voix IA ».

### Option A : sans rien installer

- Pocket TTS de Kyutai (français) : démo en ligne sur <https://kyutai.org/pocket-tts>.
- Chatterbox Multilingual (choisir le français) : démo sur Hugging Face, `ResembleAI/Chatterbox-Multilingual-TTS`.

### Option B : sur ton PC, même sans carte graphique

Pocket TTS est conçu pour tourner sur le processeur :

```bash
pip install pocket-tts
pocket-tts serve --language french
```

Ouvre ensuite <http://localhost:8000>, choisis la voix `estelle`, tape chaque phrase et télécharge le résultat. Pour une meilleure qualité, plus lente : `--language french_24l`. Il peut aussi imiter une voix à partir d'un court fichier WAV, à condition d'en avoir les droits (la tienne, par exemple).

### Option C : Chatterbox Multilingual V3 (plus expressif, plus lent sans carte graphique)

```bash
pip install chatterbox-tts
```

```python
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

phrases = [
    "Au fond d'une grotte secrète…",
    "là où la mer chante tout bas…",
    "dormait un bateau pirate",
    "que personne n'avait vu depuis cent ans.",
    "Jusqu'à cette nuit.",
]
model = ChatterboxMultilingualTTS.from_pretrained(device="cpu", t3_model="v3")
for i, text in enumerate(phrases, start=1):
    # audio_prompt_path="voix_fr.wav" pour imiter une voix française dont tu as les droits
    wav = model.generate(text, language_id="fr", exaggeration=0.6, cfg_weight=0.4)
    ta.save(f"{i}.wav", wav, model.sr)
```

Sans extrait de voix française, la voix par défaut peut garder un léger accent : fournis un extrait de 10 secondes ou mets `cfg_weight=0`.

Pinokio propose souvent ces modèles en installation en un clic : c'est le même moteur avec une interface.

## Tester avec une vraie image IA

Prompt à utiliser (en anglais, les modèles d'image le suivent mieux). La composition correspond aux réglages par défaut du lecteur :

> Children's storybook illustration, soft painterly gouache style. Inside a vast sea cave at night, seen from water level. A small old pirate ship with cream patched sails floats in the middle of the cave. Behind it, a large opening in the cave wall looks out onto the open sea, with a full moon shining through and a silver path of moonlight on the calm water. A thin waterfall pours down the left cave wall into the water. Tiny glowworms like blue stars on the cave ceiling, a few stalactites, a small treasure chest on a rock in the lower right corner. Mysterious but gentle and cozy, not scary. Wide 16:10 composition, no text.

Où la générer gratuitement :

- **En ligne** : le bac à sable de Cloudflare, <https://multi-modal.ai.cloudflare.com/>, modèle FLUX.2 [klein] 4B (licence Apache 2.0, utilisable plus tard dans l'app).
- **Sur ton PC** via Pinokio (ComfyUI) avec FLUX.2 [klein] 4B ou Z-Image Turbo : quelques secondes avec une carte graphique, plusieurs minutes sur processeur seul.

Glisse l'image sur la page, puis règle « Hauteur de la surface de l'eau » pour que les vaguelettes tombent au bon endroit. Sur une image déposée, seuls l'eau et la lumière s'animent : la cascade et les voiles demandent une carte d'effets, que la future chaîne de génération produira automatiquement.

## Ce qu'il faut juger

- [ ] **La voix** (critère n°1) : naturelle ? chaleureuse ? bon rythme ? accent ?
- [ ] **Les bruitages** : crédibles ? trop, pas assez ? bien placés ?
- [ ] **L'ambiance et la musique** : bon volume par rapport à la voix ?
- [ ] **L'image** : l'eau, la cascade, les voiles, le bateau qui sort de l'ombre, la lanterne
- [ ] **La synchronisation** entre ce qu'on entend et ce qu'on voit
- [ ] **Au global** : est-ce que ça donne envie d'entendre la suite ? Note sur 10.

## Limites connues

- La voix du navigateur dépend de l'appareil. Edge sous Windows et Safari ont les meilleures voix françaises ; Chrome sur Android est correct. Si aucune voix française n'est installée, l'intro se joue avec les sous-titres seuls.
- Les bruitages synthétisés sont des maquettes : des sons enregistrés seront plus riches.
- Les polices viennent de Google Fonts ; hors ligne, la page utilise des polices de secours.
