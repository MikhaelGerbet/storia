#!/usr/bin/env python3
"""Serveur de voix local pour le générateur Storia.

Il parle le même langage que Pocket TTS : POST /tts avec un formulaire multipart
(« text », et en option « voice_wav » pour imiter une voix). Le générateur change
donc de moteur sans changer de code : il suffit de changer d'adresse (--tts).

Exemples :
  python serveur_voix.py --moteur chatterbox --voix-ref conteur.wav
  python serveur_voix.py --moteur test     (son de test, pour vérifier l'installation)
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
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
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
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


class Handler(BaseHTTPRequestHandler):
    server_version = "StoriaVoix/1.0"
    engine: TestEngine | ChatterboxEngine
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
        started = time.perf_counter()
        try:
            audio = self.engine.synthesize(text, reference)
        except Exception as err:
            print(f"Erreur : {err}", flush=True)
            return self._json(500, {"detail": str(err)})
        print(f"{time.perf_counter() - started:5.1f} s  {text[:80]}", flush=True)
        self._send(200, audio, "audio/wav")

    def log_message(self, format: str, *args) -> None:  # noqa: A002 (nom imposé par http.server)
        pass  # le journal utile est affiché par do_POST


def main() -> None:
    parser = argparse.ArgumentParser(description="Serveur de voix local pour le générateur Storia.")
    parser.add_argument("--moteur", choices=["chatterbox", "test"], default="chatterbox")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--hote", default="127.0.0.1")
    parser.add_argument("--voix-ref", type=Path, help="extrait WAV ou MP3 (10 à 20 s) d'une voix française dont tu as les droits")
    parser.add_argument("--expressivite", type=float, default=0.6, help="de 0.25 (neutre) à 1.0 (très expressif), défaut 0.6")
    parser.add_argument("--cfg", type=float, default=0.4, help="guidage : plus bas, débit plus posé (défaut 0.4)")
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--appareil", choices=["auto", "cpu", "cuda"], default="auto", help="« cuda » désigne aussi une carte AMD avec PyTorch ROCm")
    args = parser.parse_args()
    if args.voix_ref is not None and not args.voix_ref.is_file():
        sys.exit(f"Extrait de voix introuvable : {args.voix_ref}")

    if args.moteur == "test":
        engine: TestEngine | ChatterboxEngine = TestEngine()
    else:
        engine = ChatterboxEngine(args.appareil, args.voix_ref, args.expressivite, args.cfg, args.temperature)
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
