"""
Backend FastAPI pour Yoni v2 — reconstruction de phrases à partir de pointages
sur un tableau phonétique filmé en vidéo.

Endpoints (squelette itération 1, remplis aux itérations 2-5) :
  GET  /api/calibration      → état actuel de calibration
  POST /api/calibration      → upload photo + 4 coins → calcule homographie
  POST /api/process          → upload vidéo → pipeline complet
  POST /api/learn            → enregistre la correction humaine
  GET  /api/history          → historique des phrases validées
  GET  /api/tableau          → renvoie tableau.json
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Charge .env.local s'il existe (clé Anthropic, etc.).
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

app = FastAPI(title="Yoni v2", version="0.1.0")

# CORS large en dev (front Vite sur 5173).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "anthropic_key_present": bool(os.getenv("ANTHROPIC_API_KEY")),
    }


@app.get("/api/tableau")
def get_tableau():
    if not TABLEAU_PATH.exists():
        raise HTTPException(500, "tableau.json introuvable")
    return JSONResponse(json.loads(TABLEAU_PATH.read_text(encoding="utf-8")))


@app.get("/api/calibration")
def get_calibration():
    """Retourne l'état actuel de la calibration (None si jamais calibrée)."""
    calib_file = CALIB_DIR / "calibration.json"
    if not calib_file.exists():
        return {"calibrated": False}
    data = json.loads(calib_file.read_text(encoding="utf-8"))
    return {"calibrated": True, **data}


# Les endpoints suivants seront implémentés aux itérations 2-5.


@app.post("/api/calibration")
def post_calibration():
    raise HTTPException(501, "Itération 2 — pas encore implémenté")


@app.post("/api/process")
def post_process():
    raise HTTPException(501, "Itération 3 — pas encore implémenté")


@app.post("/api/learn")
def post_learn():
    raise HTTPException(501, "Itération 5 — pas encore implémenté")


@app.get("/api/history")
def get_history():
    """Liste les sessions validées (corrections.jsonl)."""
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
