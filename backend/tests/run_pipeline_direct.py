"""
Test du pipeline en appelant run_pipeline() directement, sans FastAPI/TestClient
ni faster-whisper (stubbé). Vise à valider l'enchaînement détection→k-NN→Claude
avec un minimum d'imports lourds.
"""
import json
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

OUT = ROOT / "data" / "test" / "test_result.txt"


def emit(line: str):
    print(line, flush=True)
    with OUT.open("a") as f:
        f.write(line + "\n")


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("")
    emit(f"start {time.strftime('%H:%M:%S')}")

    # Stub transcribe AVANT que pipeline.py ne fasse `from transcribe import transcribe`.
    import transcribe as _tm

    def fake(audio_path, language="fr"):
        return {"text": "", "language": "fr", "segments": []}

    _tm.transcribe = fake
    sys.modules["transcribe"].transcribe = fake
    emit("transcribe stubbé")

    # Charger calibration + tableau
    calib = json.loads((ROOT / "data" / "calibration" / "calibration.json").read_text(encoding="utf-8"))
    tableau = json.loads((ROOT / "backend" / "tableau.json").read_text(encoding="utf-8"))
    emit("calib + tableau chargés")

    # Import pipeline et patch transcribe
    import pipeline
    pipeline.transcribe = fake
    emit("pipeline importé")

    session_id = "test_" + uuid.uuid4().hex[:8]
    session_dir = ROOT / "data" / "sessions" / session_id
    video = ROOT / "data" / "test" / "video.mp4"

    emit("appel run_pipeline …")
    t0 = time.time()
    result = pipeline.run_pipeline(video, session_dir, calib, tableau)
    emit(f"done in {time.time()-t0:.1f}s")

    emit(f"couleur_pastille_detectee: {result.get('couleur_pastille_detectee')}")
    emit(f"label_sequence: {result.get('label_sequence')}")
    emit(f"case_sequence: {result.get('case_sequence')}")
    emit(f"propositions: {result.get('propositions')}")
    emit(f"claude_error: {result.get('claude_error')}")
    if result.get("pointages"):
        p = result["pointages"][0]
        emit(f"premier pointage: knn_a_corrige={p.get('knn_a_corrige')} knn_confiance={p.get('knn_confiance')}")
    expected = ["m", "e_grave", "r", "s", "i"]
    got = result.get("case_sequence")
    if got == expected:
        emit(f"OK séquence correcte {got}")
    else:
        emit(f"KO séquence — attendue {expected}, obtenue {got}")


if __name__ == "__main__":
    main()
