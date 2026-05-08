"""
Backend FastAPI pour Yoni v2 — reconstruction de phrases à partir de pointages
sur un tableau phonétique filmé en vidéo.

Endpoints :
  GET  /api/health           → ping + état config
  GET  /api/tableau          → définition du tableau phonétique
  GET  /api/calibration      → état actuel de calibration (incluant bboxes des cases)
  POST /api/calibration      → upload photo + 4 coins → calcule homographie
  GET  /api/calibration/image → renvoie la photo de calibration (PNG/JPG)
  POST /api/process          → upload vidéo → pipeline complet      [itération 3]
  POST /api/learn            → enregistre la correction humaine     [itération 5]
  GET  /api/history          → historique des phrases validées
"""
from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

# numpy + homography sont importés à l'usage (cv2 est lourd à charger en RAM contrainte).

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")
load_dotenv(ROOT / ".env")

DATA_DIR = ROOT / "data"
CALIB_DIR = DATA_DIR / "calibration"
SESSIONS_DIR = DATA_DIR / "sessions"
CORRECTIONS_PATH = DATA_DIR / "corrections.jsonl"
TABLEAU_PATH = Path(__file__).resolve().parent / "tableau.json"

CALIB_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
CORRECTIONS_PATH.touch(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("yoni")

app = FastAPI(title="Yoni v2", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_tableau() -> dict:
    return json.loads(TABLEAU_PATH.read_text(encoding="utf-8"))


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "anthropic_key_present": bool(os.getenv("ANTHROPIC_API_KEY")),
        "version": app.version,
    }


@app.get("/api/tableau")
def get_tableau():
    if not TABLEAU_PATH.exists():
        raise HTTPException(500, "tableau.json introuvable")
    return JSONResponse(_load_tableau())


@app.get("/api/calibration")
def get_calibration():
    """Retourne l'état actuel de la calibration (calibrated=False si jamais calibrée)."""
    calib_file = CALIB_DIR / "calibration.json"
    if not calib_file.exists():
        return {"calibrated": False}
    data = json.loads(calib_file.read_text(encoding="utf-8"))
    return {"calibrated": True, **data}


@app.get("/api/calibration/image")
def get_calibration_image():
    for ext in ("jpg", "jpeg", "png"):
        p = CALIB_DIR / f"photo.{ext}"
        if p.exists():
            return FileResponse(p)
    raise HTTPException(404, "aucune image de calibration")


@app.post("/api/calibration")
async def post_calibration(
    image: UploadFile = File(..., description="photo zénithale du tableau"),
    corners: str = Form(..., description="JSON [[x,y],[x,y],[x,y],[x,y]] — TL,TR,BR,BL"),
    image_size: str = Form(..., description='JSON {"w":..., "h":...} — taille rendue côté front'),
):
    """
    Reçoit la photo + 4 coins (en coordonnées de l'image rendue côté front, après scaling)
    + la taille de l'image rendue. Convertit les coins vers les coordonnées de l'image
    originale, calcule l'homographie, sauvegarde tout.
    """
    try:
        corners_in = json.loads(corners)
        size_in = json.loads(image_size)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"corners/image_size doit être du JSON: {e}")

    if not isinstance(corners_in, list) or len(corners_in) != 4:
        raise HTTPException(400, "corners doit être une liste de 4 [x, y]")

    if not (isinstance(size_in, dict) and "w" in size_in and "h" in size_in):
        raise HTTPException(400, 'image_size doit être {"w":..., "h":...}')

    # Sauvegarde de la photo (extension préservée si jpg/png).
    suffix = (image.filename or "").lower().rsplit(".", 1)[-1]
    if suffix not in {"jpg", "jpeg", "png"}:
        suffix = "jpg"
    # Nettoie d'éventuelles photos précédentes.
    for ext in ("jpg", "jpeg", "png"):
        old = CALIB_DIR / f"photo.{ext}"
        if old.exists():
            old.unlink()
    target = CALIB_DIR / f"photo.{suffix}"
    with target.open("wb") as f:
        shutil.copyfileobj(image.file, f)

    # Décompresse pour récupérer la taille réelle.
    import cv2  # import paresseux
    from homography import cells_to_bboxes, compute_homographies

    img = cv2.imread(str(target))
    if img is None:
        target.unlink(missing_ok=True)
        raise HTTPException(400, "image illisible")
    real_h, real_w = img.shape[:2]

    # Re-projection des coins du référentiel front (size_in) vers le référentiel image originale.
    sx = real_w / float(size_in["w"]) if size_in["w"] else 1.0
    sy = real_h / float(size_in["h"]) if size_in["h"] else 1.0
    corners_real = [[float(c[0]) * sx, float(c[1]) * sy] for c in corners_in]

    tableau = _load_tableau()
    H_image_to_grid, H_grid_to_image = compute_homographies(
        corners_real, tableau["rows"], tableau["cols"]
    )
    bboxes = cells_to_bboxes(tableau, H_grid_to_image)

    payload = {
        "image_filename": target.name,
        "image_size": {"w": int(real_w), "h": int(real_h)},
        "corners_pixel": corners_real,
        "rows": tableau["rows"],
        "cols": tableau["cols"],
        "homography_image_to_grid": H_image_to_grid.tolist(),
        "homography_grid_to_image": H_grid_to_image.tolist(),
        "cells": bboxes,
    }
    (CALIB_DIR / "calibration.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log.info(
        "calibration enregistrée — image %dx%d, 4 coins, %d cases",
        real_w, real_h, len(bboxes),
    )
    return {"calibrated": True, **payload}


@app.delete("/api/calibration")
def delete_calibration():
    """Réinitialise la calibration (efface calibration.json + photo)."""
    f = CALIB_DIR / "calibration.json"
    if f.exists():
        f.unlink()
    for ext in ("jpg", "jpeg", "png"):
        p = CALIB_DIR / f"photo.{ext}"
        if p.exists():
            p.unlink()
    return {"calibrated": False}


@app.post("/api/process")
async def post_process(video: UploadFile = File(..., description="vidéo .mov ou .mp4")):
    """
    Reçoit une vidéo, lance le pipeline complet (extraction frames+audio,
    détection pastille, pointages stables, projection cases, transcription Whisper)
    et renvoie le résultat (sans encore les propositions Claude — itération 4).
    """
    import uuid
    from pipeline import run_pipeline

    calib_file = CALIB_DIR / "calibration.json"
    if not calib_file.exists():
        raise HTTPException(400, "calibration manquante — calibrer d'abord")
    calibration = json.loads(calib_file.read_text(encoding="utf-8"))
    tableau = _load_tableau()

    session_id = uuid.uuid4().hex[:12]
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    suffix = (video.filename or "").lower().rsplit(".", 1)[-1]
    if suffix not in {"mov", "mp4", "m4v", "avi", "mkv"}:
        suffix = "mp4"
    video_path = session_dir / f"video.{suffix}"
    with video_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)

    try:
        result = run_pipeline(video_path, session_dir, calibration, tableau)
    except Exception as e:
        log.exception("pipeline KO")
        raise HTTPException(500, f"pipeline a échoué : {e}") from e
    return result


@app.post("/api/learn")
async def post_learn(payload: dict):
    """
    Enregistre une correction humaine dans corrections.jsonl.
    Body : { session_id, phrase_finale, phrase_proposee_n1, phrase_humaine_corrigee }
    """
    from learn import append_correction

    session_id = payload.get("session_id")
    phrase_finale = (payload.get("phrase_finale") or "").strip()
    if not session_id or not phrase_finale:
        raise HTTPException(400, "session_id et phrase_finale obligatoires")

    session_dir = SESSIONS_DIR / session_id
    result_file = session_dir / "result.json"
    if not result_file.exists():
        raise HTTPException(404, "session inconnue")
    result = json.loads(result_file.read_text(encoding="utf-8"))

    record = append_correction(
        CORRECTIONS_PATH,
        session_id=session_id,
        phrase_finale=phrase_finale,
        phrase_proposee_n1=payload.get("phrase_proposee_n1"),
        phrase_humaine_corrigee=payload.get("phrase_humaine_corrigee"),
        pointages=result.get("pointages", []),
        audio_transcript=result.get("audio_transcript", {}).get("text", ""),
        label_sequence=result.get("label_sequence", []),
    )
    log.info("correction enregistrée — session=%s phrase=%r", session_id, phrase_finale)
    return {"ok": True, "record": record}


@app.get("/api/history")
def get_history():
    if not CORRECTIONS_PATH.exists():
        return {"sessions": []}
    sessions = []
    for line in CORRECTIONS_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            sessions.append(json.loads(line))
        except json.JSONDecodeError:
            log.warning("ligne corrections.jsonl invalide ignorée")
    return {"sessions": sessions}
