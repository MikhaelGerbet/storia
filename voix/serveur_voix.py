#!/usr/bin/env python3
"""Serveur de voix local pour le générateur Storia.

Il parle le même langage que Pocket TTS : POST /tts avec un formulaire multipart
(« text », et en option « voice_wav » pour imiter une voix). Le générateur change
donc de moteur sans changer de code : il suffit de changer d'adresse (--tts).

Exemples :
  python serveur_voix.py --voix-ref references/conteur.wav --voix-ref-texte texte-de-reference.txt
  python serveur_voix.py --voix-ref references/conteur-ia.wav --creer-voix "A warm, deep male storyteller voice"
  python serveur_voix.py --moteur chatterbox --voix-ref references/conteur.wav
  python serveur_voix.py --moteur test     (son de test, pour vérifier l'installation)
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import sys
import tempfile
import threading
import time
import wave
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def wav_bytes(samples, sample_rate: int) -> bytes:
    """Encode des échantillons flottants (entre -1 et 1) en WAV 16 bits mono."""
    try:
        import numpy as np

        pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2").tobytes()
    except ImportError:
        import array

        data = array.array("h", (max(-32768, min(32767, int(s * 32767))) for s in samples))
        if sys.byteorder == "big":
            data.byteswap()
        pcm = data.tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm)
    return buf.getvalue()


def parse_form(content_type: str, body: bytes) -> dict[str, tuple[bytes, str | None]]:
    """Lit un formulaire multipart/form-data : {nom: (contenu, nom de fichier)}."""
    if not content_type.lower().startswith("multipart/form-data"):
        raise ValueError("formulaire multipart/form-data attendu")
    message = BytesParser(policy=HTTP).parsebytes(b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body)
    fields: dict[str, tuple[bytes, str | None]] = {}
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name:
            fields[name] = (part.get_payload(decode=True) or b"", part.get_filename())
    return fields


def pick_device(choice: str, torch) -> str:
    """Carte graphique si elle répond vraiment (« cuda » désigne aussi une carte AMD avec PyTorch ROCm), sinon processeur."""
    if choice == "cpu":
        return "cpu"
    if torch.cuda.is_available():
        try:
            (torch.ones(2, device="cuda") * 2).sum().item()  # vrai calcul : is_available() peut mentir
            print(f"Carte graphique : {torch.cuda.get_device_name(0)}")
            return "cuda"
        except Exception as err:
            print(f"La carte graphique ne répond pas ({err}).")
    hiding = [f"{k}={os.environ[k]}" for k in ("HIP_VISIBLE_DEVICES", "CUDA_VISIBLE_DEVICES", "ROCR_VISIBLE_DEVICES") if k in os.environ]
    if hiding:
        print(f"{', '.join(hiding)} limite les cartes que voit PyTorch, et peut masquer la tienne : vérifie avec « py -3.12 voix/diagnostic_gpu.py ».")
    if choice == "cuda":
        sys.exit("Aucune carte graphique utilisable par PyTorch : installe PyTorch pour ta carte (voir voix/README.md) ou lance avec --appareil cpu.")
    print("Pas de carte graphique utilisable par PyTorch : la voix sera générée sur le processeur, plus lentement.")
    return "cpu"


class TestEngine:
    """Un son doux de la durée du texte, pour vérifier l'installation sans modèle."""

    label = "son de test"
    sample_rate = 24000

    def synthesize(self, text: str, reference: Path | None) -> bytes:
        n = int((0.4 + 0.06 * len(text)) * self.sample_rate)
        samples = [
            0.2 * math.sin(2 * math.pi * 220 * i / self.sample_rate) * min(1.0, i / 600, (n - i) / 600)
            for i in range(n)
        ]
        return wav_bytes(samples, self.sample_rate)


class ChatterboxEngine:
    """Chatterbox Multilingual V3 (Resemble AI, licence MIT), en français."""

    label = "Chatterbox Multilingual V3"

    def __init__(self, device: str, reference: Path | None, exaggeration: float, cfg_weight: float, temperature: float):
        try:
            import torch
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        except ImportError:
            sys.exit(
                "Chatterbox n'est pas installé dans cet environnement Python.\n"
                "Voir voix/README.md : pip install git+https://github.com/resemble-ai/chatterbox.git"
            )
        device = pick_device(device, torch)
        print(f"Chargement de Chatterbox V3 sur « {device} ». Au premier lancement, les poids du modèle se téléchargent.")
        self.model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
        self.sample_rate = self.model.sr
        self.exaggeration = exaggeration
        self.cfg_weight = cfg_weight
        self.temperature = temperature
        self.builtin = self.model.conds
        self.default_reference = reference
        self.current: Path | None = None
        self.lock = threading.Lock()
        if reference is None:
            print(
                "Attention : sans --voix-ref, Chatterbox prend sa voix intégrée, qui est anglaise : "
                "le français aura un accent. Donne un extrait de voix française de 10 à 20 secondes."
            )
            self.cfg_weight = 0.0  # atténue l'accent de la voix de référence (conseil de Resemble AI)
        self._use(reference)

    def _use(self, reference: Path | None) -> None:
        if reference == self.current and self.model.conds is not None:
            return
        if reference is None:
            self.model.conds = self.builtin
        else:
            self.model.prepare_conditionals(str(reference), exaggeration=self.exaggeration)
        self.current = reference

    def synthesize(self, text: str, reference: Path | None) -> bytes:
        with self.lock:  # un seul texte à la fois : le modèle n'est pas prévu pour le parallélisme
            self._use(reference or self.default_reference)
            audio = self.model.generate(
                text,
                language_id="fr",
                exaggeration=self.exaggeration,
                cfg_weight=self.cfg_weight,
                temperature=self.temperature,
            )
        return wav_bytes(audio.squeeze(0).detach().cpu().numpy(), self.sample_rate)


class VoxCPMEngine:
    """VoxCPM2 (OpenBMB, licence Apache 2.0) : 48 kHz, style réglable par une consigne entre parenthèses."""

    label = "VoxCPM2"

    def __init__(self, device: str, reference: Path | None, reference_text: str | None, style: str, cfg_value: float, steps: int, badcase_ratio: float, design: str | None = None):
        try:
            import torch
            from voxcpm import VoxCPM
        except ImportError:
            sys.exit("VoxCPM2 n'est pas installé dans cet environnement Python.\nVoir voix/README.md : pip install voxcpm")
        device = pick_device(device, torch)
        print(f"Chargement de VoxCPM2 sur « {device} ». Au premier lancement, les poids du modèle se téléchargent.")
        # Pas de torch.compile ni de débruiteur : deux sources de pannes sous Windows, inutiles ici.
        self.model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device=device)
        self.sample_rate = self.model.tts_model.sample_rate
        self.default_reference = reference
        self.reference_text = reference_text
        self.style = style.strip()
        self.cfg_value = cfg_value
        self.steps = steps
        # VoxCPM2 recommence une phrase quand l'audio dure plus de N fois le texte (signe d'un emballement).
        # Une narration posée dépasse souvent 6, le seuil par défaut : on le relève pour éviter des reprises inutiles.
        self.badcase_ratio = badcase_ratio
        self.lock = threading.Lock()
        if design and reference is not None and not reference.is_file():
            self.design_voice(design, reference)
        elif design:
            print(f"Voix déjà créée : {reference}. Pour en créer une autre, supprime ce fichier ou choisis un autre nom.")
        if reference is None:
            print("Sans --voix-ref, VoxCPM2 invente une voix à chaque phrase : enregistre un extrait de voix, ou crées-en une avec --creer-voix (voir voix/README.md).")

    def design_voice(self, description: str, target: Path) -> None:
        """Invente une voix d'après sa description, lui fait lire le texte de référence, et garde cette lecture comme extrait."""
        if not self.reference_text:
            sys.exit("--creer-voix a besoin d'un texte à lire : donne-le avec --voix-ref-texte.")
        print(f"Création de la voix « {description} » : lecture du texte de référence…", flush=True)
        started = time.perf_counter()
        with self.lock:
            audio = self.model.generate(
                text=f"({description.strip().strip('()')}){self.reference_text}",
                cfg_value=self.cfg_value,
                inference_timesteps=max(self.steps, 16),  # une seule fois, et toutes les phrases en héritent : on soigne
                retry_badcase_ratio_threshold=self.badcase_ratio,
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(wav_bytes(audio, self.sample_rate))
        target.with_suffix(".txt").write_text(self.reference_text + "\n", encoding="utf-8")
        print(f"Voix créée en {time.perf_counter() - started:.0f} s : {target.resolve()}")
        print("Écoute ce fichier. Si la voix ne te plaît pas, supprime-le et relance : chaque création donne une voix différente.")

    def synthesize(self, text: str, reference: Path | None) -> bytes:
        ref = reference or self.default_reference
        options: dict = {
            "text": f"{self.style}{text}" if self.style else text,
            "cfg_value": self.cfg_value,
            "inference_timesteps": self.steps,
            "retry_badcase_ratio_threshold": self.badcase_ratio,
        }
        if ref is not None:
            options["reference_wav_path"] = str(ref)
            if ref == self.default_reference and self.reference_text:
                # Clonage le plus fidèle : l'extrait et sa transcription exacte servent d'amorce.
                options["prompt_wav_path"] = str(ref)
                options["prompt_text"] = self.reference_text
        with self.lock:
            audio = self.model.generate(**options)
        return wav_bytes(audio, self.sample_rate)


class Handler(BaseHTTPRequestHandler):
    server_version = "StoriaVoix/1.0"
    engine: TestEngine | ChatterboxEngine | VoxCPMEngine
    cache_dir: Path

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: dict) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _read_body(self) -> bytes:
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            chunks = []
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    while self.rfile.readline().strip():
                        pass  # en-têtes de fin éventuels
                    return b"".join(chunks)
                chunks.append(self.rfile.read(size))
                self.rfile.readline()
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def _reference(self, data: bytes, filename: str | None) -> Path:
        """Garde chaque extrait de voix reçu dans un fichier, réutilisé s'il revient."""
        suffix = Path(filename or "voix.wav").suffix or ".wav"
        path = self.cache_dir / (hashlib.sha1(data).hexdigest() + suffix)
        if not path.exists():
            path.write_bytes(data)
        return path

    def do_GET(self) -> None:
        if self.path.split("?")[0] == "/health":
            return self._json(200, {"status": "ok", "moteur": self.engine.label})
        self._json(404, {"detail": "introuvable"})

    def do_POST(self) -> None:
        if self.path.split("?")[0] != "/tts":
            return self._json(404, {"detail": "introuvable"})
        try:
            fields = parse_form(self.headers.get("Content-Type", ""), self._read_body())
        except Exception as err:  # formulaire mal formé
            return self._json(400, {"detail": f"formulaire illisible : {err}"})
        text = fields.get("text", (b"", None))[0].decode("utf-8", "replace").strip()
        if not text:
            return self._json(400, {"detail": "le champ « text » est vide"})
        reference = None
        if fields.get("voice_wav", (b"", None))[0]:
            reference = self._reference(*fields["voice_wav"])
        print(f"… lecture de « {text[:80]} »", flush=True)
        started = time.perf_counter()
        try:
            audio = self.engine.synthesize(text, reference)
        except Exception as err:
            print(f"Erreur : {err}", flush=True)
            return self._json(500, {"detail": str(err)})
        print(f"{time.perf_counter() - started:5.1f} s  {text[:80]}", flush=True)
        try:
            self._send(200, audio, "audio/wav")
        except (BrokenPipeError, ConnectionError):
            print("Le générateur n'attendait plus cette phrase (connexion fermée de son côté).", flush=True)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 (nom imposé par http.server)
        pass  # le journal utile est affiché par do_POST


def main() -> None:
    # Git Bash et certaines consoles Windows n'écrivent pas en UTF-8 : un accent ne doit jamais faire planter le journal.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Serveur de voix local pour le générateur Storia.")
    parser.add_argument("--moteur", choices=["voxcpm", "chatterbox", "test"], default="voxcpm")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--hote", default="127.0.0.1")
    parser.add_argument("--voix-ref", type=Path, help="extrait WAV ou MP3 (10 à 20 s) d'une voix française dont tu as les droits")
    parser.add_argument("--voix-ref-texte", type=Path, help="fichier texte : transcription exacte de l'extrait (clonage plus fidèle, VoxCPM2)")
    parser.add_argument("--creer-voix", metavar="DESCRIPTION", help="VoxCPM2 : invente une voix d'après une description (en anglais de préférence) et l'enregistre dans --voix-ref, si ce fichier n'existe pas encore")
    parser.add_argument("--style", default="", help="VoxCPM2 : consigne ajoutée devant chaque phrase, par exemple « (warm storyteller, calm and slow) »")
    parser.add_argument("--etapes", type=int, default=10, help="VoxCPM2 : étapes de génération, plus = meilleur mais plus lent (défaut 10)")
    parser.add_argument("--seuil-reprise", type=float, default=10.0, help="VoxCPM2 : recommence une phrase si son audio dure plus de N fois le texte (défaut 10 ; 6 dans VoxCPM2)")
    parser.add_argument("--expressivite", type=float, default=0.6, help="Chatterbox : de 0.25 (neutre) à 1.0 (très expressif), défaut 0.6")
    parser.add_argument("--cfg", type=float, help="guidage. Chatterbox : 0 à 1, plus bas = débit plus posé (défaut 0.4). VoxCPM2 : défaut 2.0")
    parser.add_argument("--temperature", type=float, default=0.8, help="Chatterbox : variété d'une lecture à l'autre")
    parser.add_argument("--appareil", choices=["auto", "cpu", "cuda"], default="auto", help="« cuda » désigne aussi une carte AMD avec PyTorch ROCm")
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    if args.creer_voix:
        if args.moteur != "voxcpm":
            sys.exit("--creer-voix ne marche qu'avec VoxCPM2.")
        args.voix_ref = args.voix_ref or here / "references" / "voix-creee.wav"
    elif args.voix_ref is not None and not args.voix_ref.is_file():
        sys.exit(f"Extrait de voix introuvable : {args.voix_ref}\nEnregistre-le, ou crée une voix avec --creer-voix (voir voix/README.md).")
    if args.voix_ref_texte is None and args.voix_ref is not None:
        if args.voix_ref.with_suffix(".txt").is_file():
            args.voix_ref_texte = args.voix_ref.with_suffix(".txt")  # transcription rangée à côté de l'extrait
        elif args.creer_voix:
            args.voix_ref_texte = here / "texte-de-reference.txt"
    reference_text = None
    if args.voix_ref_texte is not None:
        if not args.voix_ref_texte.is_file():
            sys.exit(f"Transcription introuvable : {args.voix_ref_texte}")
        reference_text = " ".join(args.voix_ref_texte.read_text(encoding="utf-8").split())

    if args.moteur == "test":
        engine: TestEngine | ChatterboxEngine | VoxCPMEngine = TestEngine()
    elif args.moteur == "chatterbox":
        engine = ChatterboxEngine(args.appareil, args.voix_ref, args.expressivite, 0.4 if args.cfg is None else args.cfg, args.temperature)
    else:
        engine = VoxCPMEngine(args.appareil, args.voix_ref, reference_text, args.style, 2.0 if args.cfg is None else args.cfg, args.etapes, args.seuil_reprise, args.creer_voix)
    Handler.engine = engine
    Handler.cache_dir = Path(tempfile.mkdtemp(prefix="storia-voix-"))
    server = ThreadingHTTPServer((args.hote, args.port), Handler)
    print(f"Voix prête ({engine.label}) sur http://{args.hote}:{args.port}. Ctrl+C pour arrêter.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
