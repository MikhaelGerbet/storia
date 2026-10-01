#!/usr/bin/env python3
"""Cherche quelle installation de PyTorch voit la carte graphique, sans rien modifier.

Interroge chaque environnement Python de Pinokio (Wan 2.2, ComfyUI…) et ceux du projet
(.venv-…) : version de PyTorch, version de HIP, carte vue ou non. Si une application
Pinokio voit la carte, on sait quelle version de PyTorch reprendre pour la voix.

  py -3.12 voix/diagnostic_gpu.py
  py -3.12 voix/diagnostic_gpu.py --pinokio D:/IA/pinokio    (si Pinokio n'est pas trouvé)
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import string
import subprocess
import sys
import tempfile
from pathlib import Path

# Lancé par le Python de chaque environnement : n'utilise que la bibliothèque standard et torch.
PROBE = r"""
import json, os, sys
out = {"python": sys.version.split()[0]}
try:
    import torch
except Exception as err:
    out["erreur"] = "import torch : %s: %s" % (type(err).__name__, err)
else:
    out["torch"] = torch.__version__
    out["hip"] = getattr(torch.version, "hip", None)
    out["cuda"] = getattr(torch.version, "cuda", None)
    try:
        out["disponible"] = bool(torch.cuda.is_available())
        if out["disponible"]:
            out["cartes"] = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
            (torch.ones(2, device="cuda") * 2).sum().item()
            out["calcul"] = True
    except Exception as err:
        out["erreur"] = "%s: %s" % (type(err).__name__, err)
    site = os.path.dirname(os.path.dirname(torch.__file__))
    dlls = set()
    for entry in os.listdir(site):
        path = os.path.join(site, entry)
        if any(k in entry.lower() for k in ("torch", "rocm", "zluda", "hip")) and os.path.isdir(path):
            for _, _, files in os.walk(path):
                dlls.update(f for f in files if f.lower().startswith(("amdhip64", "libamdhip64")))
    out["hip_dll"] = sorted(dlls)
try:
    from importlib import metadata
    names = set()
    for dist in metadata.distributions():
        name = dist.metadata["Name"] or ""
        if any(k in name.lower() for k in ("torch", "rocm", "zluda", "directml")):
            names.add("%s==%s" % (name, dist.version))
    out["paquets"] = sorted(names)
    text = metadata.distribution("torch").read_text("direct_url.json")
    if text:
        out["source"] = json.loads(text).get("url")
except Exception:
    pass
print("STORIA_PROBE " + json.dumps(out))
"""

# Variables qui changent la carte que voit PyTorch, ou la façon dont il la voit.
GPU_VARS = re.compile(r"^(HIP_|HSA_|ROCR_|ROCM|ZLUDA|MIOPEN_|PYTORCH_ROCM)|VISIBLE_DEVICES|DEVICE_ORDINAL", re.I)
SELECT_VARS = ("HIP_VISIBLE_DEVICES", "CUDA_VISIBLE_DEVICES", "ROCR_VISIBLE_DEVICES", "GPU_DEVICE_ORDINAL", "HSA_OVERRIDE_GFX_VERSION")
# Lignes des scripts de Pinokio qui disent comment il installe et lance PyTorch sur une carte AMD.
LAUNCHER_HINT = re.compile(r"rocm|zluda|directml|HIP_|HSA_|ROCR_|gfx1\d", re.I)
SKIP_DIRS = {".git", "node_modules", "__pycache__", "models", "ckpts", "checkpoints", "outputs", "output", "input", "cache", ".cache", "loras"}
WINDOWS_SKIP = {"windows", "program files", "program files (x86)", "programdata", "system volume information", "recovery", "perflogs", "users"}


def windows_gpus() -> None:
    script = (
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | ForEach-Object { "
        "$d = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '?' }; "
        "'{0}|{1}|{2}|{3}' -f $_.Name, $_.DriverVersion, $d, $_.ConfigManagerErrorCode }"
    )
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60).stdout
    except (OSError, subprocess.TimeoutExpired):
        out = ""
    print("Cartes graphiques vues par Windows :")
    lines = [line.split("|") for line in out.splitlines() if line.count("|") == 3]
    for name, version, date, code in lines:
        state = {"0": "active", "22": "désactivée"}.get(code.strip(), f"code {code.strip()}")
        print(f"  {name} · pilote {version} du {date} · {state}")
    if not lines:
        print("  (PowerShell n'a rien répondu)")
    system32 = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32"
    dlls = sorted(p.name for p in system32.glob("amdhip64*.dll"))
    print(f"Bibliothèques HIP installées par le pilote : {', '.join(dlls) or 'aucune'}")


def pinokio_homes(extra: list[str]) -> list[Path]:
    candidates = [Path(p) for p in extra]
    if os.environ.get("PINOKIO_HOME"):
        candidates.append(Path(os.environ["PINOKIO_HOME"]))
    if os.environ.get("APPDATA"):
        try:
            home = json.loads((Path(os.environ["APPDATA"]) / "Pinokio" / "config.json").read_text(encoding="utf-8")).get("home")
            if home:
                candidates.append(Path(home))
        except (OSError, ValueError, AttributeError):
            pass
    candidates.append(Path.home() / "pinokio")
    if os.name == "nt":
        # Pinokio s'installe souvent à la racine d'un disque (C:\pinokio) ou un niveau plus bas.
        for letter in string.ascii_uppercase:
            root = Path(f"{letter}:/")
            if not root.exists():
                continue
            candidates.append(root / "pinokio")
            try:
                for entry in os.scandir(root):
                    if entry.is_dir(follow_symlinks=False) and not entry.name.startswith(("$", ".")) and entry.name.lower() not in WINDOWS_SKIP:
                        candidates.append(Path(entry.path) / "pinokio")
            except OSError:
                pass
    homes, seen = [], set()
    for candidate in candidates:
        key = os.path.normcase(os.path.abspath(candidate))
        if key not in seen and (candidate / "api").is_dir():
            seen.add(key)
            homes.append(candidate)
    return homes


def find_envs(top: Path, depth: int = 3) -> list[Path]:
    """Environnements Python (venv, uv ou conda) jusqu'à `depth` niveaux sous `top`."""
    found: list[Path] = []

    def walk(folder: Path, level: int) -> None:
        try:
            entries = list(os.scandir(folder))
        except OSError:
            return
        names = {entry.name.lower() for entry in entries}
        if "pyvenv.cfg" in names or "conda-meta" in names:
            found.append(folder)
            return
        if level < depth:
            for entry in entries:
                if entry.is_dir(follow_symlinks=False) and entry.name.lower() not in SKIP_DIRS:
                    walk(Path(entry.path), level + 1)

    walk(top, 0)
    return found


def env_python(env: Path) -> Path | None:
    for rel in ("Scripts/python.exe", "python.exe", "bin/python3", "bin/python"):
        if (env / rel).is_file():
            return env / rel
    return None


def has_torch(env: Path) -> bool:
    return (env / "Lib" / "site-packages" / "torch").is_dir() or any(env.glob("lib/python3*/site-packages/torch"))


def launcher_hints(app: Path, limit: int = 12) -> list[str]:
    hints: list[str] = []
    for script in sorted(app.glob("*.js")) + sorted(app.glob("*.json")):
        try:
            if script.stat().st_size > 300_000:
                continue
            text = script.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            if LAUNCHER_HINT.search(line):
                hints.append(f"{script.name}: {' '.join(line.split())[:220]}")
    return hints[:limit]


def probe(python: Path, drop: tuple[str, ...] = ()) -> tuple[dict | None, list[str]]:
    env = {k: v for k, v in os.environ.items() if k not in drop and k not in ("PYTHONPATH", "PYTHONHOME")}
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        run = subprocess.run(
            [str(python), "-c", PROBE], capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=240, env=env, cwd=tempfile.gettempdir(),
        )
    except subprocess.TimeoutExpired:
        return None, ["pas de réponse en 4 minutes"]
    except OSError as err:
        return None, [str(err)]
    result = next((json.loads(line[len("STORIA_PROBE "):]) for line in run.stdout.splitlines() if line.startswith("STORIA_PROBE ")), None)
    messages = [line.strip() for line in run.stderr.splitlines() if line.strip() and not line.lstrip().startswith(("warnings.warn", "File "))]
    return result, messages[-4:]


def describe(result: dict | None, messages: list[str], indent: str = "      ", brief: bool = False) -> bool:
    """Affiche le résultat d'un environnement ; renvoie True si la carte répond. `brief` : la carte seulement."""
    if not result or "torch" not in result:
        print(f"{indent}PyTorch ne se charge pas : {(result or {}).get('erreur') or ' / '.join(messages) or 'raison inconnue'}")
        return False
    backend = f"HIP {result['hip']}" if result.get("hip") else f"CUDA {result['cuda']}" if result.get("cuda") else "processeur seulement"
    if not brief:
        print(f"{indent}PyTorch {result['torch']} · {backend} · Python {result['python']}")
    ok = bool(result.get("disponible") and result.get("calcul"))
    if result.get("disponible"):
        print(f"{indent}Carte vue : {', '.join(result.get('cartes', []))}" + (", calcul ok" if result.get("calcul") else f", mais le calcul échoue ({result.get('erreur')})"))
    else:
        print(f"{indent}Carte vue : aucune" + (f" ({result['erreur']})" if result.get("erreur") else ""))
    if brief:
        return ok
    if result.get("hip_dll"):
        print(f"{indent}Bibliothèque HIP : {', '.join(result['hip_dll'])}")
    if result.get("paquets"):
        print(f"{indent}Paquets : {', '.join(result['paquets'])}")
    if result.get("source"):
        print(f"{indent}Source : {result['source']}")
    if not ok and messages:
        print(f"{indent}Messages : {' / '.join(messages)}")
    return ok


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Cherche quelle installation de PyTorch voit la carte graphique, sans rien modifier.")
    parser.add_argument("--pinokio", action="append", default=[], help="dossier de Pinokio, s'il n'est pas trouvé tout seul")
    args = parser.parse_args()

    print("Storia : quelle installation de PyTorch voit la carte graphique ?")
    print(platform.platform())
    if os.name == "nt":
        windows_gpus()
    gpu_vars = {k: v for k, v in os.environ.items() if GPU_VARS.search(k)}
    print("Variables d'environnement liées à la carte : " + (", ".join(f"{k}={v}" for k, v in sorted(gpu_vars.items())) or "aucune"))

    project = Path(__file__).resolve().parent.parent
    envs: list[tuple[Path, Path | None]] = [(env, None) for env in sorted(project.glob(".venv-*")) if env.is_dir()]
    homes = pinokio_homes(args.pinokio)
    for home in homes:
        apps = sorted(p for p in (home / "api").iterdir() if p.is_dir())
        print(f"Pinokio : {home} ({len(apps)} applications)")
        envs += [(env, app) for app in apps for env in find_envs(app)]
    if not homes:
        print("Pinokio : introuvable. Relance avec --pinokio suivi du dossier de Pinokio (indiqué dans ses réglages).")

    candidates = [(env, app, python) for env, app in envs if (python := env_python(env)) and has_torch(env)]
    print(f"\n{len(candidates)} environnements avec PyTorch, quelques secondes chacun :")
    working: list[str] = []
    hinted: set[Path] = set()
    dropped = tuple(k for k in SELECT_VARS if k in os.environ)
    for i, (env, app, python) in enumerate(candidates, 1):
        print(f"\n[{i}/{len(candidates)}] {env}", flush=True)
        result, messages = probe(python)
        if describe(result, messages):
            working.append(f"{env} (PyTorch {result['torch']})")
        if dropped:
            again, again_messages = probe(python, dropped)
            print(f"      Sans {', '.join(dropped)} :", flush=True)
            if describe(again, again_messages, indent="        ", brief=True):
                working.append(f"{env} (PyTorch {again['torch']}), sans {', '.join(dropped)}")
        if app and app not in hinted:
            hinted.add(app)
            for hint in launcher_hints(app):
                print(f"      Lanceur · {hint}")

    print()
    if working:
        print("La carte répond avec :")
        for line in working:
            print(f"  {line}")
    else:
        print("Aucun de ces environnements ne voit la carte depuis ce terminal.")
        if homes:
            print("Si une application marche quand même dans Pinokio, il la lance avec d'autres réglages : les lignes « Lanceur » ci-dessus les montrent.")
    print("Copie tout ce texte dans la conversation.")


if __name__ == "__main__":
    main()
