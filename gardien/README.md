# Le gardien de la carte graphique

Ta carte graphique ne peut faire tourner qu'un gros modèle à la fois. Si Storia et Oula lancent Wan en même temps, chacun croit avoir les 20 Go pour lui, et les deux deviennent très lents.

Le gardien règle ce problème. C'est un petit service qui tourne en permanence, et tout programme qui veut la carte graphique la lui demande d'abord :

- **Une seule file pour toute la carte** : un programme à la fois, par priorité (`haute`, `normale`, `basse`) puis par ordre d'arrivée. Une histoire Storia (`haute`, un enfant attend) passe avant le lot du matin d'Oula (`basse`), sans interrompre la tâche en cours.
- **Chargement à la demande** : rien n'a besoin d'être préchargé. Wan2GP est lancé pour chaque tâche puis s'arrête ; le serveur de voix de Storia est démarré par le gardien quand une histoire en a besoin. Après un redémarrage du PC, tout repart seul.
- **Déchargement à la fin** : quand personne ne demande plus la carte depuis 2 minutes, le gardien la vide. Il décharge les modèles d'Ollama et demande au serveur de voix de rendre sa mémoire. Il fait aussi ce ménage entre deux programmes différents.
- **Mode jeu** : dès qu'un jeu se lance (Steam, Epic, GOG, Xbox, Riot, EA, Ubisoft, Amazon), la carte lui est réservée. Le programme qui la tenait est prévenu aussitôt et s'arrête, puis le gardien vide la carte. Les demandes attendent la fin de la partie, puis reprennent seules : une histoire interrompue recommence du début.
- **Un programme planté ne bloque rien** : sans signe de vie pendant 90 secondes, sa réservation est rendue.

## Lancer

Node.js 22.18 ou plus récent suffit : le gardien n'a aucune dépendance.

```powershell
cd gardien
npm start
```

Sa page s'ouvre sur <http://localhost:7870> : qui a la carte, qui attend, et un gros bouton **Mode jeu**.

### À chaque ouverture de session Windows

```powershell
powershell -ExecutionPolicy Bypass -File gardien\windows\installer.ps1 -Studio
```

Le script programme le gardien (et, avec `-Studio`, le studio Storia) pour qu'il démarre caché à chaque ouverture de session. Il pose aussi trois raccourcis sur le bureau : **Mode jeu**, **Reprendre** et la page du gardien. Ce qu'ils affichent va dans `gardien\journaux\` (et `serveur\journaux\`). Pour tout retirer : `installer.ps1 -Retirer`.

Ajoute `-Reseau` pour ouvrir l'application aux tablettes et aux téléphones du Wi-Fi : l'adresse à taper est au début de `serveur\journaux\console.log`. Si tout était déjà installé, ferme ta session et rouvre-la pour que le studio reparte avec ce réglage.

Après un redémarrage, il faut ouvrir sa session pour que le gardien démarre. Si Oula doit tourner à 4 h du matin après une mise à jour nocturne de Windows, active l'ouverture de session automatique, ou demande-moi une tâche qui démarre sans session.

## Réglages : gardien.json

Copie `gardien.exemple.json` en `gardien.json`, à côté (ce fichier reste sur ton PC, il n'est pas dans Git), puis adapte-le :

| Réglage | Rôle |
|---|---|
| `ollama` | Ollama, dont les modèles sont déchargés au ménage (`null` si tu ne t'en sers pas) |
| `inactiviteMinutes` | Combien de temps garder les modèles chargés quand plus personne ne demande la carte (2) |
| `jeux.actif` | Le mode jeu automatique (`true`) |
| `jeux.interrompre` | `true` : un jeu interrompt la tâche en cours (elle recommencera). `false` : elle finit d'abord |
| `jeux.executables` | Des jeux à reconnaître par leur nom, où qu'ils soient : `["minecraft.exe"]` |
| `jeux.dossiers` / `jeux.ignorer` | D'autres dossiers de jeux, ou des programmes à ne jamais compter comme des jeux |
| `services` | Les serveurs que le gardien lance à la demande : la commande, son dossier, l'adresse qui répond quand il est prêt (`sante`), celle qui lui fait rendre la carte (`liberer`) |
| `liberer` | D'autres adresses à appeler (POST) pour qu'un serveur rende la mémoire de la carte |
| `wan.dossier`, `wan.modeles` | Wan2GP (sinon cherché dans Pinokio) et son dossier de modèles (`P:/wan-modeles`) |

## Le mode jeu

- **Automatique** : le gardien regarde toutes les 10 secondes si un programme tourne depuis un dossier de jeux. Il rend la carte 30 secondes après la fermeture du jeu, pour qu'un jeu qui redémarre ne fasse pas tout repartir. Wallpaper Engine et les lanceurs (Epic, Riot) ne comptent pas.
- **À la main** : le raccourci **Mode jeu**, ou le bouton de la page du gardien, y compris sur le téléphone avec `npm start -- --reseau`. **Reprendre** rend la carte aux programmes.
- **Un petit jeu qui ne gêne pas ?** Appuie sur **Reprendre** pendant qu'il tourne : le gardien le laisse jouer sans lui réserver la carte, jusqu'à ce qu'il se ferme.

## Brancher un programme : Oula

Deux façons de faire, selon la manière dont Oula appelle Wan aujourd'hui. Cherche dans son code `wgp.py` (Wan2GP lancé directement), `gradio_client` ou `7860` (l'interface de Pinokio), `8188` (ComfyUI).

### 1. Confier les tâches Wan au gardien (le plus simple)

Oula envoie ses réglages Wan2GP, ceux qu'on obtient avec le bouton « Export Settings » de son interface. Le gardien attend son tour, lance Wan2GP sans interface, puis le referme : la carte est libre dès que le lot est fini. C'est la bonne façon si Oula passe aujourd'hui par l'interface de Pinokio : elle garde le modèle chargé en permanence.

En Python, avec `clients/gardien.py` (aucune dépendance) :

```python
from gardien import tache_wan

fichier = tache_wan(
    {"model_type": "i2v_2_2", "prompt": "elle sourit et cligne des yeux", "image_start": "C:/avatars/lea.png",
     "resolution": "832x480", "video_length": 81},
    client="oula", motif="avatar de Léa", priorite="basse",
)
```

Directement en HTTP :

```bash
curl -X POST http://127.0.0.1:7870/api/wan -H "content-type: application/json" \
  -d '{"client": "oula", "priorite": "basse", "reglages": {"model_type": "i2v_2_2", "prompt": "…"}}'
curl http://127.0.0.1:7870/api/wan/<id>            # etat, avancement, fichier
curl -O http://127.0.0.1:7870/api/wan/<id>/fichier # le résultat
```

### 2. Réserver la carte pendant qu'Oula s'en sert lui-même

Si Oula garde sa façon de faire (ComfyUI, son propre code…), il réserve la carte autour de son travail. Il doit alors s'arrêter si un jeu la réclame, et tout décharger à la fin.

```python
from gardien import CarteGraphique

with CarteGraphique("oula", motif="avatars du matin", priorite="basse") as carte:
    for avatar in avatars:
        if carte.reprise.is_set():   # un jeu réclame la carte
            break                    # on s'arrête ; on recommencera plus tard
        generer(avatar)
```

En TypeScript, avec `src/client.ts` :

```ts
import { reserveGpu } from '../gardien/src/client.ts';

const carte = await reserveGpu({ url: 'http://127.0.0.1:7870', client: 'oula', priorite: 'basse' });
try {
  await generer({ signal: carte.revoked }); // annulé si un jeu démarre
} finally {
  await carte.release();
}
```

## L'API

| Requête | Rôle |
|---|---|
| `GET /` | la page du gardien |
| `GET /api/etat` | qui a la carte, qui attend, les tâches, les services, le dernier ménage |
| `POST /api/reservations` | `{client, motif?, priorite?}` : demande la carte. Réponse : `etat` (`attente` ou `accordee`), `position`, `attente` (pourquoi on attend) |
| `GET /api/reservations/:id?attendre=20&depuis=attente` | attend (20 s au plus) que l'état change ; sert aussi de signe de vie. Pendant qu'on tient la carte : `depuis=accordee`, la réponse revient dès qu'un jeu la réclame (`revoquee`) |
| `DELETE /api/reservations/:id` | rend la carte |
| `POST /api/wan` | `{client, reglages, priorite?, motif?, attendu? (video ou image), dossier?}` : une tâche Wan2GP |
| `GET /api/wan/:id`, `GET /api/wan/:id/fichier`, `DELETE /api/wan/:id` | suivre, récupérer, annuler une tâche |
| `POST /api/services/:nom/demarrer` | lance un service (la voix) et attend qu'il soit prêt |
| `POST /api/pause`, `POST /api/reprise` | mode jeu à la main |
| `POST /api/menage` | vide la carte tout de suite (si personne ne la tient) |

Les requêtes `POST` doivent être en JSON : une page web ne peut donc pas les envoyer à ton insu. Sans `--reseau`, seul ce PC peut joindre le gardien.

## Si un jour l'IA part sur une autre machine

Installe sur cette machine tout ce qui se sert de la carte graphique : Ollama, le serveur de voix, Wan2GP, le gardien, le studio Storia et Oula. Ils s'y parlent sur `127.0.0.1`, comme aujourd'hui : aucune adresse à changer. Le studio et Oula ne peuvent pas rester sur ton PC de jeu : le studio lance Wan2GP sur la machine où il tourne, et Wan2GP lit ses images et écrit ses vidéos sur son propre disque.

- Programme-les avec `installer.ps1 -Studio -Reseau` : ton PC et la tablette ouvrent l'application avec l'adresse de cette machine.
- Le mode jeu ne sert plus à rien là-bas : `"jeux": {"actif": false}` dans `gardien.json`.
- Pour qu'elle reparte seule après une mise à jour de Windows, active l'ouverture de session automatique, par exemple avec l'outil Autologon de Microsoft (Sysinternals).

## Tests

```bash
npm test          # file, ménage, mode jeu, tâches Wan, services, client TypeScript
npm run verifier  # TypeScript
```
