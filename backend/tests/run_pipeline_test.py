"""Test rapide du pipeline (sans clé Anthropic → claude_error attendu)."""
import sys
import time
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
    OUT.write_text("")  # reset
    emit(f"start {time.strftime('%H:%M:%S')}")
    from fastapi.testclient import TestClient
    from app import app

    c = TestClient(app)
    emit("client OK, calling /api/process …")
    t0 = time.time()
    with open(ROOT / "data" / "test" / "video.mp4", "rb") as f:
        r = c.post("/api/process", files={"video": ("video.mp4", f, "video/mp4")})
    emit(f"done in {time.time()-t0:.1f}s — status: {r.status_code}")
    data = r.json()
    emit(f"propositions: {data.get('propositions')}")
    emit(f"claude_error: {data.get('claude_error')}")
    emit(f"label_sequence: {data.get('label_sequence')}")
    emit(f"couleur_pastille_detectee: {data.get('couleur_pastille_detectee')}")


if __name__ == "__main__":
    main()
