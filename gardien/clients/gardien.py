"""Client du gardien de la carte graphique, pour les programmes en Python (Oula…). Aucune dépendance.

Copie ce fichier à côté de ton programme, puis, au choix :

    from gardien import CarteGraphique, tache_wan

    # 1. Réserver la carte graphique pendant que tu t'en sers toi-même (ComfyUI, ton propre code…)
    with CarteGraphique("oula", motif="avatar 12", priorite="basse") as carte:
        for etape in etapes:
            if carte.reprise.is_set():   # un jeu réclame la carte : arrête-toi au plus vite
                break
            faire(etape)

    # 2. Ou confier une tâche Wan2GP au gardien : il attend son tour, lance Wan, puis le referme
    fichier = tache_wan({"model_type": "i2v_2_2", "prompt": "il sourit", "image_start": "C:/avatars/a.png"}, client="oula")

Les réglages Wan2GP se récupèrent dans son interface avec le bouton « Export Settings ».
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:7870"


class GardienErreur(Exception):
    """Le gardien a refusé la demande, ou la tâche a échoué."""


def _appel(methode: str, chemin: str, corps: dict | None = None, url: str = URL, delai: float = 40):
    """Une requête au gardien ; None si ce qu'on cherche n'existe pas (404)."""
    data = None if corps is None else json.dumps(corps).encode("utf-8")
    entetes = {"content-type": "application/json"} if data is not None else {}
    requete = urllib.request.Request(url + chemin, data=data, method=methode, headers=entetes)
    try:
        with urllib.request.urlopen(requete, timeout=delai) as reponse:
            return json.loads(reponse.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as erreur:
        if erreur.code == 404:
            return None
        raise GardienErreur(f"{erreur.code} : {erreur.read().decode('utf-8', 'replace')}") from None


class CarteGraphique:
    """Réserve la carte graphique le temps d'un bloc `with`. Attend son tour s'il le faut."""

    def __init__(self, client: str, motif: str = "", priorite: str = "normale", url: str = URL, afficher=print):
        self.client, self.motif, self.priorite, self.url, self.afficher = client, motif, priorite, url, afficher
        self.id: str | None = None
        #: Posé quand le gardien reprend la carte (mode jeu) : arrête-toi au plus vite, puis recommence plus tard.
        self.reprise = threading.Event()
        self._fin = threading.Event()

    def __enter__(self) -> "CarteGraphique":
        vue = None
        while True:
            try:
                if vue is None:
                    vue = _appel("POST", "/api/reservations", {"client": self.client, "motif": self.motif, "priorite": self.priorite}, self.url)
                if vue["etat"] == "accordee":
                    break
                if vue.get("attente"):
                    self.afficher(f"La carte graphique {vue['attente']}…")
                vue = _appel("GET", f"/api/reservations/{vue['id']}?attendre=20&depuis=attente", url=self.url)
                if vue is None or vue["etat"] in ("revoquee", "terminee"):
                    vue = None  # le gardien a redémarré, ou un jeu est passé : on redemande
                elif vue["etat"] == "accordee":
                    break
            except (urllib.error.URLError, ConnectionError, TimeoutError):
                self.afficher("Le gardien de la carte graphique ne répond pas : nouvel essai dans 5 s.")
                time.sleep(5)
        self.id = vue["id"]
        threading.Thread(target=self._surveiller, daemon=True).start()
        return self

    def _surveiller(self) -> None:
        # Une attente longue qui revient dès que le gardien reprend la carte.
        while not self._fin.is_set():
            try:
                vue = _appel("GET", f"/api/reservations/{self.id}?attendre=25&depuis=accordee", url=self.url)
                if vue is None or vue["etat"] != "accordee":
                    self.reprise.set()
                    return
            except Exception:
                self._fin.wait(2)

    def __exit__(self, *exc) -> bool:
        self._fin.set()
        try:
            _appel("DELETE", f"/api/reservations/{self.id}", url=self.url, delai=5)
        except Exception:
            pass  # le gardien la rendra seul, faute de signe de vie
        return False


def tache_wan(reglages: dict, client: str = "oula", motif: str | None = None, priorite: str = "basse",
              attendu: str = "video", dossier: str | None = None, url: str = URL, afficher=print) -> str:
    """Confie une génération Wan2GP au gardien et renvoie le chemin du fichier produit."""
    corps = {"client": client, "reglages": reglages, "priorite": priorite, "attendu": attendu}
    if motif:
        corps["motif"] = motif
    if dossier:
        corps["dossier"] = dossier
    tache = _appel("POST", "/api/wan", corps, url)
    dernier = None
    while True:
        etat = _appel("GET", f"/api/wan/{tache['id']}", url=url)
        if etat is None:
            raise GardienErreur("Le gardien ne connaît plus cette tâche (il a redémarré ?) : relance-la.")
        if etat["etat"] == "terminee":
            return etat["fichier"]
        if etat["etat"] in ("echec", "annulee"):
            raise GardienErreur(etat.get("erreur") or f"tâche {etat['etat']}")
        message = f"En attente (rang {etat['position']})" if etat["etat"] == "attente" else f"Wan : {round(etat['avancement'] * 100)} %"
        if message != dernier:
            afficher(message)
            dernier = message
        time.sleep(2)
