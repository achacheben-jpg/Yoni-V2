"""
Test du pipeline en stubbant Whisper (faster-whisper trop lourd à charger sur RAM contrainte).
Valide : détection couleur fuchsia, pointages stables, projection homographique, k-NN, appel Claude (graceful).
"""
import sys
import time
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

OUT = ROOT / "data" / "test" / "test_result.txt"


def emit(line: str):
    print(line, flush=True)
    with OUT.open("a") as f:
        f.write(line + "\n")


def fake_transcribe(audio_path, language="fr"):
    return {"text": "", "language": "fr", "segments": []}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("")
    emit(f"start {time.strftime('%H:%M:%S')}")

    # Patch transcribe AVANT d'importer pipeline (qui l'importe au top-level).
    import transcribe as _transcribe_mod
    _transcribe_mod.transcribe = fake_transcribe
    sys.modules["transcribe"].transcribe = fake_transcribe
    emit("transcribe stubbé")

    from fastapi.testclient import TestClient
    from app import app
    emit("app importé")

    # Re-patch sur l'instance importée par pipeline (au moment de l'appel à /api/process,
    # pipeline.py fait `from transcribe import transcribe`).
    # Pour s'assurer que pipeline utilise le stub, on patche sa référence module aussi.
    import pipeline as _pl
    _pl.transcribe = fake_transcribe

    c = TestClient(app)
    emit("calling /api/process …")
    t0 = time.time()
    with open(ROOT / "data" / "test" / "video.mp4", "rb") as f:
        r = c.post("/api/process", files={"video": ("video.mp4", f, "video/mp4")})
    emit(f"done in {time.time()-t0:.1f}s — status: {r.status_code}")

    if r.status_code != 200:
        emit(f"BODY: {r.text[:500]}")
        return

    data = r.json()
    emit(f"couleur_pastille_detectee: {data.get('couleur_pastille_detectee')}")
    emit(f"label_sequence: {data.get('label_sequence')}")
    emit(f"case_sequence: {data.get('case_sequence')}")
    emit(f"propositions: {data.get('propositions')}")
    emit(f"claude_error: {data.get('claude_error')}")
    emit(f"nb_pointages: {len(data.get('pointages', []))}")
    if data.get("pointages"):
        p = data["pointages"][0]
        emit(f"premier pointage: knn_a_corrige={p.get('knn_a_corrige')} knn_confiance={p.get('knn_confiance')}")
    expected = ["m", "e_grave", "r", "s", "i"]
    got = data.get("case_sequence")
    if got == expected:
        emit(f"OK séquence correcte {got}")
    else:
        emit(f"KO séquence — attendue {expected}, obtenue {got}")


if __name__ == "__main__":
    main()
