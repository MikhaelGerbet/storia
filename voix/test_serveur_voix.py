"""Tests du serveur de voix, sans modèle : py -3.12 -m unittest discover voix (numpy requis pour la plupart)."""
from __future__ import annotations

import base64
import io
import json
import sys
import threading
import unittest
import urllib.request
import wave
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import serveur_voix as sv  # noqa: E402

np = sv.np
SCENE = [
    ("Au fond d'une grotte secrète…", 0.6),
    ("là où la mer chante tout bas…", 0.7),
    ("dormait un bateau pirate", 0.25),
    ("que personne n'avait vu depuis cent ans.", 1.0),
    ("Jusqu'à cette nuit.", 0.3),
]
TEXTS = [t for t, _ in SCENE]
PAUSES = [p for _, p in SCENE]


def tone(seconds: float, rate: int):
    t = np.arange(int(seconds * rate)) / rate
    return (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def quiet(seconds: float, rate: int):
    return np.zeros(int(seconds * rate), dtype=np.float32)


class FakeListener:
    """Remplace Whisper : renvoie le texte prévu, ou un autre, avec des mots datés."""

    name = "faux-whisper"

    def __init__(self, heard: str | None = None, words=None):
        self.heard, self.words, self.calls = heard, words or [], 0

    def listen(self, audio, rate, timestamps=True):
        self.calls += 1
        return self.heard or "", self.words


class Flaky:
    """Un moteur qui rate ses premières lectures (trop longues), puis lit correctement."""

    device = "cpu"
    label = "instable"

    def __init__(self, failures: int):
        self.failures, self.calls, self.inner = failures, 0, sv.TestEngine()

    def generate(self, text, reference=None, style=None, settings=None):
        self.calls += 1
        if self.calls <= self.failures:
            return np.concatenate([tone(0.5, 24000), quiet(4.0, 24000), tone(9.0, 24000)]), 24000
        return self.inner.generate(text)


class TorchcodecTests(unittest.TestCase):
    def test_broken_torchcodec_is_bypassed(self):
        # torchcodec installé mais incompatible avec PyTorch : son import plante (cas des cartes AMD sous Windows)
        import tempfile

        root = Path(tempfile.mkdtemp())
        (root / "torchcodec").mkdir()
        (root / "torchcodec" / "__init__.py").write_text('raise OSError("Could not load this library: libtorchcodec_image.dll")\n')
        (root / "transformers" / "pipelines").mkdir(parents=True)
        (root / "transformers" / "__init__.py").write_text("")
        (root / "transformers" / "pipelines" / "__init__.py").write_text("")
        (root / "transformers" / "pipelines" / "automatic_speech_recognition.py").write_text("def is_torchcodec_available():\n    return True\n")
        saved = {k: v for k, v in sys.modules.items() if k.split(".")[0] in ("torchcodec", "transformers")}
        for k in saved:
            del sys.modules[k]
        sys.path.insert(0, str(root))
        try:
            sv.avoid_broken_torchcodec()
            import transformers.pipelines.automatic_speech_recognition as asr

            self.assertFalse(asr.is_torchcodec_available())
        finally:
            sys.path.remove(str(root))
            for k in [k for k in sys.modules if k.split(".")[0] in ("torchcodec", "transformers")]:
                del sys.modules[k]
            sys.modules.update(saved)


class TextTests(unittest.TestCase):
    def test_numbers_and_words(self):
        self.assertEqual(sv.spell_number(71), "soixante-et-onze")
        self.assertEqual(sv.spell_number(80), "quatre-vingts")
        self.assertEqual(sv.spell_number(1999), "mille neuf cent quatre-vingt-dix-neuf")
        self.assertEqual(sv.words("Depuis 100 ans, l'œuf"), ["depuis", "cent", "ans", "l", "oeuf"])

    def test_resemblance(self):
        text = "que personne n'avait vu depuis cent ans."
        self.assertGreater(sv.resemblance(text, "Que personne n'avait vu depuis 100 ans."), 0.95)
        self.assertLess(sv.resemblance(text, "que personne n'av"), 0.8)
        self.assertLess(sv.resemblance("Au fond d'une grotte secrète…", "Il était une fois, au bord d'une mer très calme, un petit phare qui ne dormait jamais."), 0.5)

    def test_sentences(self):
        groups = sv.group_sentences(TEXTS)
        self.assertEqual(groups, [[0, 1, 2, 3], [4]])
        text = sv.sentence_text(TEXTS, PAUSES, groups[0])
        self.assertIn("bateau pirate, que personne", text)  # pause voulue, annoncée par une virgule
        self.assertIn("secrète… là où", text)  # déjà ponctuée : rien à ajouter
        self.assertEqual(sv.group_sentences(["Il pleut.", "Il vente…", "Le vent souffle"]), [[0], [1], [2]])

    def test_expected_range(self):
        low, high = sv.expected_range("Au fond d'une grotte secrète…")
        self.assertLess(low, 1.5)
        self.assertGreater(high, 3.0)
        self.assertLess(high, 11.2)  # la lecture de 11,2 s observée était bien ratée


@unittest.skipIf(np is None, "numpy manquant")
class AudioTests(unittest.TestCase):
    def test_tidy_trims_and_levels(self):
        rate = 24000
        raw = np.concatenate([quiet(1.0, rate), tone(1.0, rate) * 0.1, quiet(2.0, rate)])
        audio = sv.tidy(raw, rate)
        self.assertLess(len(audio) / rate, 1.4)
        level = float(np.sqrt(np.mean(np.square(audio[int(0.1 * rate) : int(0.9 * rate)]))))
        self.assertAlmostEqual(level, 0.12, delta=0.02)

    def test_split_in_silences(self):
        engine = sv.TestEngine()
        idxs = sv.group_sentences(TEXTS)[0]
        text = sv.sentence_text(TEXTS, PAUSES, idxs)
        samples, rate = engine.generate(text)
        take = sv.Take(sv.tidy(samples, rate), rate)
        pieces, removed = sv.split(take, [TEXTS[i] for i in idxs])
        self.assertEqual(len(pieces), 4)
        self.assertEqual(len(removed), 3)
        for gap in removed:
            self.assertGreater(gap, 0.15)  # chaque coupe tombe dans le blanc d'une virgule ou de points de suspension
        for piece in pieces:
            self.assertLess(abs(float(piece[-1])), 0.05)

    def test_split_follows_whisper_words(self):
        rate = 24000
        # « un deux » puis « trois » : deux blancs, le plus long au mauvais endroit
        audio = np.concatenate([tone(0.4, rate), quiet(0.12, rate), tone(0.4, rate), quiet(0.5, rate), tone(0.4, rate)])
        heard = [("un", 0.0, 0.4), ("deux", 0.52, 0.92), ("trois", 1.42, 1.82)]
        take = sv.Take(audio, rate, words=heard)
        pieces, _ = sv.split(take, ["un", "deux trois"])
        self.assertAlmostEqual(len(pieces[0]) / rate, 0.46, delta=0.05)

    def test_retry_until_reading_is_plausible(self):
        narrator = sv.Narrator(Flaky(failures=1), None, attempts=3)
        take = narrator.say("Au fond d'une grotte secrète…")
        self.assertIsNone(take.problem)
        self.assertEqual(take.attempts, 2)

    def test_whisper_rejects_another_text(self):
        listener = FakeListener(heard="Il était une fois, au bord d'une mer très calme")
        narrator = sv.Narrator(sv.TestEngine(), listener, attempts=2)
        take = narrator.say("Jusqu'à cette nuit.")
        self.assertIn("Whisper a entendu", take.problem)
        self.assertEqual(listener.calls, 2)

    def test_whisper_failure_does_not_stop_reading(self):
        class Broken:
            name = "cassé"

            def listen(self, audio, rate, timestamps=True):
                raise OSError("Could not load this library")

        narrator = sv.Narrator(sv.TestEngine(), Broken(), attempts=2)
        take = narrator.say("Jusqu'à cette nuit.")
        self.assertIsNone(take.problem)
        self.assertIsNone(take.similarity)
        self.assertIsNone(narrator.listener)  # la suite se passe de Whisper

    def test_release_then_reload(self):
        class Releasable(sv.TestEngine):
            def __init__(self):
                self.loaded, self.loads = True, 0

            def release(self):
                was, self.loaded = self.loaded, False
                return was

            def generate(self, text, reference=None, style=None, settings=None):
                if not self.loaded:
                    self.loaded, self.loads = True, self.loads + 1
                return super().generate(text)

        engine = Releasable()
        narrator = sv.Narrator(engine, None, attempts=1)
        self.assertTrue(narrator.release())
        self.assertFalse(narrator.release())  # déjà libérée
        narrator.say("Jusqu'à cette nuit.")
        self.assertEqual(engine.loads, 1)

    def test_settings_reach_the_engine(self):
        seen = []

        class Recorder(sv.TestEngine):
            def generate(self, text, reference=None, style=None, settings=None):
                seen.append(settings)
                return super().generate(text)

        narrator = sv.Narrator(Recorder(), None, attempts=1)
        settings = sv.parse_settings({"etapes": "24", "cfg": "2.5", "style": "(warm storyteller)"})
        self.assertEqual(settings, {"etapes": 24, "cfg": 2.5, "style": "(warm storyteller)"})
        narrator.narrate(TEXTS, PAUSES, None, lambda e: None, settings)
        self.assertEqual(seen, [settings, settings])  # une lecture par phrase, chacune avec les réglages
        with self.assertRaises(ValueError):
            sv.parse_settings({"vitesse": 2})

    def test_narrate(self):
        events = []
        narrator = sv.Narrator(sv.TestEngine(), None, attempts=1)
        narrator.narrate(TEXTS, PAUSES, None, events.append)
        self.assertEqual([e["type"] for e in events], ["debut", "phrase", "phrase", "fin"])
        segments = events[-1]["segments"]
        self.assertEqual(len(segments), 5)
        for segment, pause in zip(segments, PAUSES):
            self.assertGreaterEqual(segment["pause"], pause)
            with wave.open(io.BytesIO(base64.b64decode(segment["wav"]))) as w:
                self.assertGreater(w.getnframes() / w.getframerate(), 0.3)


@unittest.skipIf(np is None, "numpy manquant")
class HttpTests(unittest.TestCase):
    def test_recit_streams_progress(self):
        sv.Handler.narrator = sv.Narrator(sv.TestEngine(), None, attempts=1)
        sv.Handler.cache_dir = Path(__import__("tempfile").mkdtemp())
        server = ThreadingHTTPServer(("127.0.0.1", 0), sv.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            url = f"http://127.0.0.1:{server.server_address[1]}"
            with urllib.request.urlopen(f"{url}/health") as response:
                self.assertTrue(json.load(response)["recit"])
            body = json.dumps({"segments": [{"text": t, "pause": p} for t, p in SCENE]}).encode()
            request = urllib.request.Request(f"{url}/recit", data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request) as response:
                lines = [json.loads(line) for line in response.read().decode().splitlines()]
            with urllib.request.urlopen(urllib.request.Request(f"{url}/liberer", data=b"", method="POST")) as response:
                self.assertEqual(json.load(response), {"libere": False})  # le moteur de test n'occupe pas la carte
            self.assertEqual(lines[0]["type"], "debut")
            self.assertEqual(lines[-1]["type"], "fin")
            self.assertEqual(len(lines[-1]["segments"]), 5)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
