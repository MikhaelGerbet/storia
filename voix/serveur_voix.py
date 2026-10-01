#!/usr/bin/env python3
"""Serveur de voix local pour le générateur Storia.

Deux portes d'entrée :
  POST /tts    un texte, un WAV. Même langage que Pocket TTS (formulaire multipart « text »,
               et en option « voice_wav » pour imiter une voix) : le générateur change de moteur
               en changeant d'adresse (--tts).
  POST /recit  toute une scène, en JSON. Chaque phrase est lue d'un seul souffle, ce qui garde une
               intonation naturelle, puis découpée en segments pour caler les bruitages. Whisper
               relit chaque lecture : une phrase sautée, tronquée ou bredouillée est recommencée.
               La réponse arrive ligne par ligne (NDJSON), pour suivre la progression.

Exemples :
  python serveur_voix.py --voix-ref references/conteur.wav
  python serveur_voix.py --voix-ref references/conteur-ia.wav --creer-voix "A warm, deep male storyteller voice"
  python serveur_voix.py --moteur chatterbox --voix-ref references/conteur.wav
  python serveur_voix.py --moteur test     (son de test, pour vérifier l'installation)
"""
from __future__ import annotations

import argparse
import base64
import difflib
import hashlib
import io
import json
import math
import os
import re
import sys
import tempfile
import threading
import time
import unicodedata
import wave
from dataclasses import dataclass, field
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import numpy as np
except ImportError:  # le moteur de test tourne aussi sur un Python sans numpy, sans retouche du son
    np = None


def wav_bytes(samples, sample_rate: int) -> bytes:
    """Encode des échantillons flottants (entre -1 et 1) en WAV 16 bits mono."""
    if np is not None:
        pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2").tobytes()
    else:
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


# --------------------------------------------------------------------------- texte

_UNITS = "zéro un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize".split()
_TENS = {2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante", 8: "quatre-vingt"}


def _below_100(n: int) -> str:
    if n < 17:
        return _UNITS[n]
    if n < 20:
        return "dix-" + _UNITS[n - 10]
    tens, unit = divmod(n, 10)
    if tens in (7, 9):  # soixante-dix, quatre-vingt-onze…
        return _TENS[tens - 1] + ("-et-" if n == 71 else "-") + _below_100(10 + unit)
    if tens == 8:
        return "quatre-vingts" if unit == 0 else "quatre-vingt-" + _UNITS[unit]
    return _TENS[tens] + ("" if unit == 0 else "-et-un" if unit == 1 else "-" + _UNITS[unit])


def spell_number(n: int) -> str:
    """Un nombre en toutes lettres : Whisper écrit « 100 » là où le texte dit « cent »."""
    if n >= 1_000_000:
        return str(n)
    thousands, rest = divmod(n, 1000)
    hundreds, units = divmod(rest, 100)
    parts = []
    if thousands:
        parts.append("mille" if thousands == 1 else f"{spell_number(thousands)} mille")
    if hundreds:
        parts.append("cent" if hundreds == 1 else f"{_UNITS[hundreds]} cent{'s' if units == 0 else ''}")
    if units or not parts:
        parts.append(_below_100(units))
    return " ".join(parts)


def words(text: str) -> list[str]:
    """Mots comparables : minuscules, sans accents ni ponctuation, nombres en lettres."""
    text = re.sub(r"\d+", lambda m: f" {spell_number(int(m.group()))} ", text)
    text = text.lower().replace("œ", "oe").replace("æ", "ae")
    text = "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")
    return re.findall(r"[a-z]+", text)


def letter_count(text: str) -> int:
    return sum(len(w) for w in words(text))


def resemblance(expected: str, heard: str) -> float:
    a, b = " ".join(words(expected)), " ".join(words(heard))
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


LETTERS_PER_SECOND = 11.0  # débit d'un conteur posé, en français


def expected_range(text: str) -> tuple[float, float]:
    """Durée de parole plausible, en secondes : beaucoup plus court ou plus long trahit une lecture ratée."""
    n = max(1, letter_count(text))
    pauses = len(re.findall(r"[,;:…—]|\.\.\.", text))
    return n / (LETTERS_PER_SECOND * 2), n / (LETTERS_PER_SECOND / 2) + 1.0 + 0.6 * pauses


_SENTENCE_END = re.compile(r"[.!?][\"»”)\s]*$")


def group_sentences(texts: list[str], max_letters: int = 300) -> list[list[int]]:
    """Regroupe les segments en phrases complètes : une phrase lue d'un seul souffle garde son intonation."""
    groups: list[list[int]] = []
    current: list[int] = []
    size = 0
    for i, text in enumerate(texts):
        current.append(i)
        size += letter_count(text)
        last = i + 1 == len(texts)
        following = "" if last else texts[i + 1].strip()
        ends = bool(_SENTENCE_END.search(text.strip())) or (text.strip().endswith("…") and following[:1].isupper())
        if last or ends or size + letter_count(following) > max_letters:
            groups.append(current)
            current, size = [], 0
    return groups


def sentence_text(texts: list[str], pauses: list[float], idxs: list[int]) -> str:
    """Le texte d'une phrase à lire d'un trait. Une virgule marque les pauses voulues que rien n'annonce."""
    parts = []
    for k, i in enumerate(idxs):
        part = " ".join(texts[i].split())
        if k < len(idxs) - 1 and pauses[i] >= 0.2 and part and part[-1] not in ",;:…—" and not part.endswith("..."):
            part += ","
        parts.append(part)
    return " ".join(parts)


# --------------------------------------------------------------------------- son

FRAME = 0.02  # analyse par tranches de 20 ms


def frame_levels(audio, rate: int):
    n = max(1, int(rate * FRAME))
    count = len(audio) // n
    if count == 0:
        return np.zeros(0, dtype=np.float32)
    return np.sqrt(np.mean(np.square(audio[: count * n].reshape(count, n)), axis=1))


def silence_floor(levels) -> float:
    return max(0.002, float(np.percentile(levels, 95)) * 0.08) if len(levels) else 0.002


def voiced_span(levels, floor: float) -> tuple[int, int] | None:
    loud = np.nonzero(levels >= floor)[0]
    return (int(loud[0]), int(loud[-1]) + 1) if len(loud) else None


def silences(levels, floor: float, min_seconds: float = 0.06) -> list[tuple[float, float]]:
    """Silences intérieurs (début, fin), en secondes, entre le premier et le dernier son."""
    span = voiced_span(levels, floor)
    if span is None:
        return []
    runs, start = [], None
    for k in range(span[0], span[1] + 1):
        quiet = k < span[1] and levels[k] < floor
        if quiet and start is None:
            start = k
        elif not quiet and start is not None:
            if (k - start) * FRAME >= min_seconds:
                runs.append((start * FRAME, k * FRAME))
            start = None
    return runs


def fade(audio, rate: int, seconds: float = 0.008):
    """Fondus très courts aux deux bouts : pas de clic à la coupe."""
    n = min(len(audio) // 2, int(rate * seconds))
    if n <= 0:
        return audio
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    audio = np.array(audio, dtype=np.float32)
    audio[:n] *= ramp
    audio[-n:] *= ramp[::-1]
    return audio


def tidy(samples, rate: int, target_rms: float = 0.12, peak: float = 0.89):
    """Coupe les blancs du début et de la fin, puis met la voix au même niveau d'une phrase à l'autre."""
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    levels = frame_levels(audio, rate)
    floor = silence_floor(levels)
    span = voiced_span(levels, floor)
    if span is None:
        return audio
    audio = audio[max(0, int((span[0] * FRAME - 0.06) * rate)) : min(len(audio), int((span[1] * FRAME + 0.15) * rate))]
    voiced = levels[span[0] : span[1]]
    voiced = voiced[voiced >= floor]
    level = float(np.sqrt(np.mean(np.square(voiced)))) if len(voiced) else 0.0
    if level > 0:
        gain = min(8.0, target_rms / level)
        top = float(np.max(np.abs(audio))) * gain
        if top > peak:
            gain *= peak / top
        audio = audio * gain
    return fade(audio, rate)


def align(parts: list[str], heard: list[tuple[str, float, float]]) -> list[float | None]:
    """Moment de chaque frontière entre segments, d'après les mots datés par Whisper (None si introuvable)."""
    if not heard:
        return [None] * (len(parts) - 1)
    expected = [(w, p) for p, part in enumerate(parts) for w in words(part)]
    spoken = [(w, start, end) for text, start, end in heard for w in words(text)]
    matcher = difflib.SequenceMatcher(None, [w for w, _ in expected], [w for w, _, _ in spoken], autojunk=False)
    match: dict[int, int] = {}
    for i, j, size in matcher.get_matching_blocks():
        for k in range(size):
            match[i + k] = j + k
    result: list[float | None] = []
    for b in range(len(parts) - 1):
        last = max((i for i, (_, p) in enumerate(expected) if p == b), default=None)
        first = min((i for i, (_, p) in enumerate(expected) if p == b + 1), default=None)
        left = max((i for i in match if last is not None and i <= last), default=None)
        right = min((i for i in match if first is not None and i >= first), default=None)
        if left is None or right is None or last - left > 2 or right - first > 2:
            result.append(None)
            continue
        end, begin = spoken[match[left]][2], spoken[match[right]][1]
        result.append((end + begin) / 2 if begin >= end else end)
    return result


def split(take: Take, parts: list[str]) -> tuple[list, list[float]]:
    """Découpe une phrase lue en segments, dans le silence le plus proche de chaque frontière.

    Renvoie les morceaux et, pour chaque frontière, la durée de silence retirée : elle redevient
    une pause dans le lecteur, qui garde ainsi le rythme de la lecture.
    """
    audio, rate = take.audio, take.rate
    if len(parts) == 1:
        return [audio], []
    levels = frame_levels(audio, rate)
    floor = silence_floor(levels)
    span = voiced_span(levels, floor) or (0, len(levels))
    first_s, last_s = span[0] * FRAME, span[1] * FRAME
    gaps = silences(levels, floor)
    dated = align(parts, take.words)
    letters = [letter_count(p) for p in parts]
    total = sum(letters) or 1
    cuts: list[tuple[float, float]] = []
    previous, done = first_s, 0
    for b in range(len(parts) - 1):
        done += letters[b]
        guess = dated[b] if dated[b] is not None else first_s + (last_s - first_s) * done / total
        reach = 0.25 if dated[b] is not None else max(0.35, 0.15 * (last_s - first_s))
        near = [g for g in gaps if g[0] >= previous and abs((g[0] + g[1]) / 2 - guess) <= reach + (g[1] - g[0]) / 2]
        if near:
            start, stop = min(near, key=lambda g: abs((g[0] + g[1]) / 2 - guess))
            end = min(stop, start + 0.06)
            begin = max(end, stop - 0.04)
        else:  # pas de silence : on coupe au creux d'énergie le plus proche
            lo = max(int(previous / FRAME), int((guess - 0.12) / FRAME), 0)
            hi = min(len(levels), max(lo + 1, int((guess + 0.12) / FRAME)))
            k = lo + int(np.argmin(levels[lo:hi])) if lo < hi else min(len(levels), int(guess / FRAME))
            end = begin = (k + 0.5) * FRAME
        cuts.append((end, begin))
        previous = begin
    edges = [0.0] + [t for cut in cuts for t in cut] + [len(audio) / rate]
    pieces = [audio[int(edges[2 * i] * rate) : int(edges[2 * i + 1] * rate)] for i in range(len(parts))]
    return pieces, [round(begin - end, 2) for end, begin in cuts]


# --------------------------------------------------------------------------- moteurs


class TestEngine:
    """Un son doux qui imite le débit d'une voix (un bip par mot, un blanc aux virgules), sans modèle."""

    label = "son de test"
    sample_rate = 24000
    device = "cpu"

    def generate(self, text: str, reference: Path | None = None, style: str | None = None):
        rate = self.sample_rate
        ramp = int(0.01 * rate)
        out = [0.0] * int(0.1 * rate)
        for word in text.split():
            n = int((0.08 + 0.055 * sum(c.isalnum() for c in word)) * rate)
            out += [0.2 * math.sin(2 * math.pi * 220 * i / rate) * min(1.0, i / ramp, (n - i) / ramp) for i in range(n)]
            out += [0.0] * int((0.5 if word[-1] in ".!?" else 0.35 if word[-1] in ",;:…" else 0.05) * rate)
        return out + [0.0] * int(0.1 * rate), rate


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
        self.device = pick_device(device, torch)
        print(f"Chargement de Chatterbox V3 sur « {self.device} ». Au premier lancement, les poids du modèle se téléchargent.")
        self.model = ChatterboxMultilingualTTS.from_pretrained(device=self.device, t3_model="v3")
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

    def generate(self, text: str, reference: Path | None = None, style: str | None = None):
        with self.lock:  # un seul texte à la fois : le modèle n'est pas prévu pour le parallélisme
            self._use(reference or self.default_reference)
            audio = self.model.generate(
                text,
                language_id="fr",
                exaggeration=self.exaggeration,
                cfg_weight=self.cfg_weight,
                temperature=self.temperature,
            )
        return audio.squeeze(0).detach().cpu().numpy(), self.sample_rate


class VoxCPMEngine:
    """VoxCPM2 (OpenBMB, licence Apache 2.0) : 48 kHz, style réglable par une consigne entre parenthèses."""

    label = "VoxCPM2"

    def __init__(self, device: str, reference: Path | None, reference_text: str | None, style: str, cfg_value: float, steps: int, length_cap: float):
        try:
            import torch
            from voxcpm import VoxCPM
        except ImportError:
            sys.exit("VoxCPM2 n'est pas installé dans cet environnement Python.\nVoir voix/README.md : pip install voxcpm")
        self.device = pick_device(device, torch)
        print(f"Chargement de VoxCPM2 sur « {self.device} ». Au premier lancement, les poids du modèle se téléchargent.")
        # Pas de torch.compile ni de débruiteur : deux sources de pannes sous Windows, inutiles ici.
        self.model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device=self.device)
        self.sample_rate = self.model.tts_model.sample_rate
        self.default_reference = reference
        self.reference_text = reference_text
        # Reprendre l'extrait et sa transcription comme amorce donne l'imitation la plus fidèle, mais
        # seulement si la transcription colle mot à mot à l'enregistrement : sinon le modèle se perd,
        # saute la phrase ou en lit une autre. On ne l'active donc qu'après vérification par Whisper.
        self.continuation = False
        self.style = style.strip()
        self.cfg_value = cfg_value
        self.steps = steps
        # Au-delà de N fois la longueur du texte, VoxCPM2 coupe la lecture : c'est qu'elle s'emballe.
        self.length_cap = length_cap
        self.lock = threading.Lock()

    def generate(self, text: str, reference: Path | None = None, style: str | None = None):
        """`style` remplace la consigne de ton ; il sert aussi à inventer une voix, sans extrait."""
        ref = reference or self.default_reference
        continuing = self.continuation and style is None and ref is not None and ref == self.default_reference
        prefix = (style if style is not None else "" if continuing else self.style).strip().strip("()")
        options: dict = {
            "text": f"({prefix}){text}" if prefix else text,
            "cfg_value": self.cfg_value,
            "inference_timesteps": self.steps,
            "retry_badcase": False,  # le serveur vérifie lui-même chaque lecture, Whisper à l'appui
            "retry_badcase_ratio_threshold": self.length_cap,
        }
        if ref is not None:
            options["reference_wav_path"] = str(ref)
            if continuing:
                options["prompt_wav_path"] = str(ref)
                options["prompt_text"] = self.reference_text
        with self.lock:
            audio = self.model.generate(**options)
        return audio, self.sample_rate


# --------------------------------------------------------------------------- relecture et récit


class Listener:
    """Whisper relit chaque lecture : on sait ce que la voix a vraiment dit, et quand chaque mot commence."""

    def __init__(self, model: str, device: str):
        import torch
        from transformers import pipeline

        dtype = torch.float16 if device == "cuda" else torch.float32
        last: Exception | None = None
        for extra in ({"dtype": dtype}, {"torch_dtype": dtype}, {}):  # le nom du réglage a changé selon les versions
            try:
                self.pipe = pipeline("automatic-speech-recognition", model=model, device=device, **extra)
                break
            except TypeError as err:
                last = err
        else:
            raise last or RuntimeError("Whisper ne se charge pas")
        self.name = model.split("/")[-1]
        self.lock = threading.Lock()

    def listen(self, audio, rate: int, timestamps: bool = True) -> tuple[str, list[tuple[str, float, float]]]:
        audio = np.asarray(audio, dtype=np.float32)
        if rate != 16000:
            import librosa

            audio = librosa.resample(audio, orig_sr=rate, target_sr=16000)
        options: dict = {"generate_kwargs": {"language": "french", "task": "transcribe"}}
        if len(audio) > 30 * 16000:
            options["chunk_length_s"] = 30
        elif timestamps:
            options["return_timestamps"] = "word"
        with self.lock:
            out = self.pipe({"raw": audio, "sampling_rate": 16000}, **options)
        heard = []
        for chunk in out.get("chunks") or []:
            start, end = chunk.get("timestamp") or (None, None)
            if start is not None:
                heard.append((str(chunk.get("text", "")).strip(), float(start), float(end if end is not None else start)))
        return str(out.get("text", "")).strip(), heard


@dataclass
class Take:
    """Une lecture d'un texte, déjà nettoyée, avec le verdict de la vérification."""

    audio: object
    rate: int
    score: float = 1.0
    problem: str | None = None
    similarity: float | None = None
    heard: str | None = None
    words: list = field(default_factory=list)  # (mot, début, fin) datés par Whisper
    attempts: int = 1

    @property
    def seconds(self) -> float:
        return len(self.audio) / self.rate


class Narrator:
    """Fait lire un texte au moteur, vérifie la lecture et recommence si elle a raté."""

    def __init__(self, engine, listener: Listener | None, attempts: int):
        self.engine = engine
        self.listener = listener
        self.attempts = max(1, attempts)

    def check(self, audio, rate: int, text: str) -> Take:
        take = Take(audio, rate)
        levels = frame_levels(audio, rate)
        longest = max((b - a for a, b in silences(levels, silence_floor(levels))), default=0.0)
        low, high = expected_range(text)
        if take.seconds < low:
            take.problem, take.score = f"trop court : {take.seconds:.1f} s de parole pour {low:.1f} s au moins", take.seconds / low
        elif take.seconds > high:
            take.problem, take.score = f"trop long : {take.seconds:.1f} s de parole pour {high:.1f} s au plus", high / take.seconds
        elif longest > 1.8:
            take.problem, take.score = f"un silence de {longest:.1f} s au milieu", 1.8 / longest
        if self.listener:
            take.heard, take.words = self.listener.listen(audio, rate)
            take.similarity = resemblance(text, take.heard)
            take.score *= take.similarity
            needed = 0.7 if letter_count(text) < 15 else 0.8
            if take.problem is None and take.similarity < needed:
                take.problem = f"Whisper a entendu « {take.heard[:160]} » ({take.similarity:.0%} de ressemblance)"
        return take

    def say(self, text: str, reference: Path | None = None, style: str | None = None) -> Take:
        best: Take | None = None
        for attempt in range(1, self.attempts + 1):
            samples, rate = self.engine.generate(text, reference, style)
            if np is None:
                return Take(samples, rate)
            take = self.check(tidy(samples, rate), rate, text)
            take.attempts = attempt
            if take.problem is None:
                return take
            print(f"  lecture {attempt} ratée ({take.problem}){', on recommence' if attempt < self.attempts else ''}.", flush=True)
            if best is None or take.score > best.score:
                best = take
        best.attempts = self.attempts
        return best

    def narrate(self, texts: list[str], pauses: list[float], reference: Path | None, emit) -> None:
        if np is None:  # Python sans numpy : un segment après l'autre, sans vérification ni découpe
            emit({"type": "debut", "phrases": len(texts), "relecture": None})
            clips = []
            for number, text in enumerate(texts, 1):
                started = time.perf_counter()
                samples, rate = self.engine.generate(text, reference)
                clips.append(wav_bytes(samples, rate))
                emit({"type": "phrase", "numero": number, "total": len(texts), "secondes": round(time.perf_counter() - started, 1), "parole": round(len(samples) / rate, 1), "essais": 1})
            emit({"type": "fin", "segments": [{"wav": base64.b64encode(c).decode("ascii"), "pause": p} for c, p in zip(clips, pauses)]})
            return
        groups = group_sentences(texts)
        emit({"type": "debut", "phrases": len(groups), "relecture": self.listener.name if self.listener else None})
        clips: list = [None] * len(texts)
        new_pauses = list(pauses)
        rate = 0
        for number, idxs in enumerate(groups, 1):
            text = sentence_text(texts, pauses, idxs)
            print(f"… phrase {number}/{len(groups)} : « {text[:100]} »", flush=True)
            started = time.perf_counter()
            take = self.say(text, reference)
            rate = take.rate
            pieces, removed = split(take, [texts[i] for i in idxs])
            for k, i in enumerate(idxs):
                clips[i] = fade(pieces[k], rate)
                if k < len(idxs) - 1:
                    new_pauses[i] = round(max(pauses[i], removed[k]), 2)
            took = time.perf_counter() - started
            verdict = f", relue à {take.similarity:.0%}" if take.similarity is not None else ""
            print(f"{took:5.1f} s  phrase {number}/{len(groups)} : {take.seconds:.1f} s de parole{verdict}" + (f"  ATTENTION : {take.problem}" if take.problem else ""), flush=True)
            emit({
                "type": "phrase", "numero": number, "total": len(groups), "secondes": round(took, 1),
                "parole": round(take.seconds, 1), "essais": take.attempts, "texte": text,
                "ressemblance": None if take.similarity is None else round(take.similarity, 2),
                "entendu": take.heard, "alerte": take.problem,
            })
        emit({"type": "fin", "segments": [{"wav": base64.b64encode(wav_bytes(c, rate)).decode("ascii"), "pause": p} for c, p in zip(clips, new_pauses)]})

    def verify_reference(self, path: Path, transcript: str) -> bool:
        """L'enregistrement dit-il bien sa transcription ? Seulement alors on s'en sert comme amorce."""
        if not self.listener:
            print("Sans Whisper, la transcription de l'extrait ne peut pas être vérifiée : la voix est imitée sans elle, ce qui est plus sûr.")
            return False
        import librosa

        audio, rate = librosa.load(str(path), sr=16000, mono=True)
        heard, _ = self.listener.listen(audio, rate, timestamps=False)
        similarity = resemblance(transcript, heard)
        if similarity >= 0.85:
            print(f"L'extrait de voix dit bien sa transcription ({similarity:.0%}) : imitation la plus fidèle.")
            return True
        print(f"L'extrait de voix ne dit pas exactement sa transcription ({similarity:.0%} de ressemblance). Whisper a entendu :\n  « {heard[:400]} »")
        print("La voix est donc imitée sans la transcription, ce qui est plus sûr. Pour l'imitation la plus fidèle, corrige le texte pour qu'il colle mot à mot à l'enregistrement.")
        return False

    def design(self, description: str, target: Path, text: str) -> bool:
        """Invente une voix d'après sa description et garde sa lecture du texte de référence comme extrait."""
        print(f"Création de la voix « {description} » : lecture du texte de référence…", flush=True)
        started = time.perf_counter()
        steps = self.engine.steps
        self.engine.steps = max(steps, 16)  # une seule fois, et toutes les phrases en héritent : on soigne
        try:
            take = self.say(text, style=description)
        finally:
            self.engine.steps = steps
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(wav_bytes(take.audio, take.rate))
        target.with_suffix(".txt").write_text(text + "\n", encoding="utf-8")
        print(f"Voix créée en {time.perf_counter() - started:.0f} s : {target.resolve()}")
        print("Écoute ce fichier. Si la voix ne te plaît pas, supprime-le et relance : chaque création donne une voix différente.")
        return take.problem is None and take.similarity is not None


# --------------------------------------------------------------------------- serveur HTTP


class Handler(BaseHTTPRequestHandler):
    server_version = "StoriaVoix/2.0"
    narrator: Narrator
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
            listener = self.narrator.listener
            return self._json(200, {"status": "ok", "moteur": self.narrator.engine.label, "recit": True, "relecture": listener.name if listener else None})
        self._json(404, {"detail": "introuvable"})

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        if path == "/tts":
            return self._tts()
        if path == "/recit":
            return self._recit()
        self._json(404, {"detail": "introuvable"})

    def _tts(self) -> None:
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
            take = self.narrator.say(text, reference)
        except Exception as err:
            print(f"Erreur : {err}", flush=True)
            return self._json(500, {"detail": str(err)})
        print(f"{time.perf_counter() - started:5.1f} s  {text[:80]}" + (f"  ATTENTION : {take.problem}" if take.problem else ""), flush=True)
        try:
            self._send(200, wav_bytes(take.audio, take.rate), "audio/wav")
        except (BrokenPipeError, ConnectionError):
            print("Le générateur n'attendait plus cette phrase (connexion fermée de son côté).", flush=True)

    def _recit(self) -> None:
        try:
            request = json.loads(self._read_body() or b"{}")
            segments = request["segments"]
            texts = [" ".join(str(s["text"]).split()) for s in segments]
            pauses = [float(s.get("pause", 0.4)) for s in segments]
            if not texts or not all(texts):
                raise ValueError("segments vides")
            reference = self._reference(base64.b64decode(request["voice_wav"]), request.get("voice_name")) if request.get("voice_wav") else None
        except Exception as err:
            return self._json(400, {"detail": f"scène illisible : {err}"})
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        def emit(event: dict) -> None:
            self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"))
            self.wfile.flush()

        try:
            self.narrator.narrate(texts, pauses, reference, emit)
        except (BrokenPipeError, ConnectionError):
            print("Le générateur n'attend plus ce récit (connexion fermée de son côté).", flush=True)
        except Exception as err:
            print(f"Erreur : {err}", flush=True)
            try:
                emit({"type": "erreur", "detail": str(err)})
            except (BrokenPipeError, ConnectionError):
                pass

    def log_message(self, format: str, *args) -> None:  # noqa: A002 (nom imposé par http.server)
        pass  # le journal utile est affiché par les lectures


def main() -> None:
    # Git Bash et certaines consoles Windows n'écrivent pas en UTF-8 : un accent ne doit jamais faire planter le journal.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    # Cartes AMD : sans ce réglage, chaque nouvelle longueur de phrase relance une longue recherche des meilleurs
    # calculs (MIOpen), qui peut prendre plus que la lecture elle-même. Sans effet sur les autres cartes.
    os.environ.setdefault("MIOPEN_FIND_MODE", "FAST")
    parser = argparse.ArgumentParser(description="Serveur de voix local pour le générateur Storia.")
    parser.add_argument("--moteur", choices=["voxcpm", "chatterbox", "test"], default="voxcpm")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--hote", default="127.0.0.1")
    parser.add_argument("--voix-ref", type=Path, help="extrait WAV ou MP3 (10 à 30 s) d'une voix française dont tu as les droits")
    parser.add_argument("--voix-ref-texte", type=Path, help="fichier texte : transcription exacte de l'extrait (imitation plus fidèle, VoxCPM2, si Whisper confirme qu'elle colle à l'enregistrement)")
    parser.add_argument("--creer-voix", metavar="DESCRIPTION", help="VoxCPM2 : invente une voix d'après une description (en anglais de préférence) et l'enregistre dans --voix-ref, si ce fichier n'existe pas encore")
    parser.add_argument("--style", default="", help="VoxCPM2 : consigne de ton ajoutée devant chaque phrase, par exemple « (warm storyteller, calm and slow) »")
    parser.add_argument("--etapes", type=int, default=10, help="VoxCPM2 : étapes de génération, plus = meilleur mais plus lent (défaut 10)")
    parser.add_argument("--seuil-reprise", type=float, default=6.0, help="VoxCPM2 : une lecture est coupée au-delà de N fois la longueur du texte, signe qu'elle s'emballe (défaut 6)")
    parser.add_argument("--essais", type=int, default=3, help="lectures au plus pour une phrase ratée (défaut 3)")
    parser.add_argument("--relecture", default="openai/whisper-large-v3-turbo", help="modèle Whisper qui relit chaque phrase, ou « aucune » (défaut openai/whisper-large-v3-turbo)")
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
    designing = bool(args.creer_voix) and not args.voix_ref.is_file()
    if args.creer_voix and not designing:
        print(f"Voix déjà créée : {args.voix_ref}. Pour en créer une autre, supprime ce fichier ou choisis un autre nom.")

    if args.moteur == "test":
        engine: TestEngine | ChatterboxEngine | VoxCPMEngine = TestEngine()
    elif args.moteur == "chatterbox":
        engine = ChatterboxEngine(args.appareil, args.voix_ref, args.expressivite, 0.4 if args.cfg is None else args.cfg, args.temperature)
    else:
        engine = VoxCPMEngine(args.appareil, None if designing else args.voix_ref, reference_text, args.style, 2.0 if args.cfg is None else args.cfg, args.etapes, args.seuil_reprise)

    listener = None
    if args.moteur != "test" and np is not None and args.relecture.lower() not in ("aucune", "non", "none"):
        print(f"Relecture : chargement de Whisper ({args.relecture}). Au premier lancement, il se télécharge (environ 1,6 Go).", flush=True)
        try:
            listener = Listener(args.relecture, engine.device)
        except Exception as err:
            print(f"Whisper n'a pas pu se charger ({type(err).__name__} : {err}). Les lectures seront jugées sur leur seule durée.")
    narrator = Narrator(engine, listener, args.essais)

    if isinstance(engine, VoxCPMEngine):
        if designing:
            verified = narrator.design(args.creer_voix, args.voix_ref, reference_text)
            engine.default_reference = args.voix_ref
            engine.continuation = verified
        elif reference_text and args.voix_ref is not None:
            engine.continuation = narrator.verify_reference(args.voix_ref, reference_text)
        elif args.voix_ref is None:
            print("Sans --voix-ref, VoxCPM2 invente une voix à chaque phrase : enregistre un extrait de voix, ou crées-en une avec --creer-voix (voir voix/README.md).")
    if args.moteur != "test":
        # La toute première lecture est très lente (préparation des calculs) : on la fait avant le premier récit.
        print("Préchauffage…", flush=True)
        started = time.perf_counter()
        samples, rate = engine.generate("Bonjour, je suis prêt à raconter.")
        if listener:
            listener.listen(tidy(samples, rate), rate)
        print(f"Préchauffage terminé en {time.perf_counter() - started:.0f} s.", flush=True)

    Handler.narrator = narrator
    Handler.cache_dir = Path(tempfile.mkdtemp(prefix="storia-voix-"))
    server = ThreadingHTTPServer((args.hote, args.port), Handler)
    print(f"Voix prête ({engine.label}{', relue par ' + listener.name if listener else ''}) sur http://{args.hote}:{args.port}. Ctrl+C pour arrêter.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
