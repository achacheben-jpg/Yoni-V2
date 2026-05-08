"""
Pipeline de traitement d'une session vidéo :
  1. Extraction audio (ffmpeg)
  2. Extraction frames à 10 fps (ffmpeg)
  3. Choix de la couleur de pastille (fuchsia → vert fluo en fallback)
  4. Détection de la pastille sur chaque frame
  5. Identification des pointages stables (>0.4s, mouvement <15px)
  6. Projection homographique pixel → case via la calibration
  7. Transcription audio (Whisper local)
  8. Écriture debug.log + result.json

Tout est isolable : le dispatch (couleur de pastille, framerate, Whisper, etc.)
peut être paramétré via la fonction `run_pipeline`.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from static_ffmpeg import add_paths as _ffmpeg_add_paths

from detect_fluo_marker import _detect_one_color, best_color_over_frames
from homography import pixel_to_cell
from transcribe import transcribe

_ffmpeg_add_paths()  # ajoute ffmpeg + ffprobe au PATH du process
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"

# Paramètres pipeline
FRAMES_FPS = 10
MAX_JUMP_PX = 15.0          # mouvement max au sein d'un pointage stable
MIN_POINTING_DURATION_S = 0.4
MAX_GAP_S = 0.5             # trou max sans détection avant de fermer un cluster
COLOR_THRESHOLD_RATIO = 0.30


@dataclass
class FrameDetection:
    timestamp: float
    x: int
    y: int
    color: str  # "fuchsia" | "green_fluo"
    area: int
    confidence: float


def _ts_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


class DebugLogger:
    def __init__(self, path: Path):
        self.path = path
        self.f = path.open("w", encoding="utf-8")
        self._t0 = time.time()

    def log(self, msg: str, **kw):
        elapsed = time.time() - self._t0
        line = f"[{_ts_now()}][+{elapsed:6.2f}s] {msg}"
        if kw:
            line += " " + json.dumps(kw, ensure_ascii=False, default=str)
        self.f.write(line + "\n")
        self.f.flush()
        logging.getLogger("yoni.pipeline").info(line)

    def step(self, label: str):
        return _Step(self, label)

    def close(self):
        self.f.close()


class _Step:
    def __init__(self, logger: DebugLogger, label: str):
        self.logger = logger
        self.label = label

    def __enter__(self):
        self.t0 = time.time()
        self.logger.log(f"▶ {self.label} — début")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        d = time.time() - self.t0
        if exc_type:
            self.logger.log(f"✗ {self.label} — erreur en {d:.2f}s : {exc_val}")
        else:
            self.logger.log(f"✓ {self.label} — terminé en {d:.2f}s")


def _run_ffmpeg(args: list[str], dbg: DebugLogger) -> None:
    """Lance ffmpeg en sous-processus, avec capture stderr en cas d'erreur."""
    cmd = [FFMPEG, *args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        dbg.log("ffmpeg KO", returncode=proc.returncode, stderr_tail=proc.stderr[-500:])
        raise RuntimeError(f"ffmpeg a échoué (code {proc.returncode})")


def extract_audio(video_path: Path, audio_out: Path, dbg: DebugLogger):
    with dbg.step("extraction audio"):
        _run_ffmpeg(
            ["-y", "-i", str(video_path), "-ar", "16000", "-ac", "1", "-vn", str(audio_out)],
            dbg,
        )


def extract_frames(video_path: Path, frames_dir: Path, dbg: DebugLogger, fps: int = FRAMES_FPS):
    frames_dir.mkdir(exist_ok=True, parents=True)
    pattern = str(frames_dir / "f_%05d.jpg")
    with dbg.step(f"extraction frames {fps} fps"):
        _run_ffmpeg(
            ["-y", "-i", str(video_path), "-vf", f"fps={fps}", "-q:v", "3", pattern],
            dbg,
        )


def _list_frames(frames_dir: Path) -> list[Path]:
    return sorted(frames_dir.glob("f_*.jpg"))


def detect_marker_on_frames(
    frame_paths: list[Path], color: str, fps: int, dbg: DebugLogger
) -> list[FrameDetection]:
    """Pour chaque frame, applique la détection de la couleur fixée."""
    detections: list[FrameDetection] = []
    with dbg.step(f"détection pastille {color} sur {len(frame_paths)} frames"):
        for i, p in enumerate(frame_paths):
            img = cv2.imread(str(p))
            if img is None:
                continue
            d = _detect_one_color(img, color)  # type: ignore[arg-type]
            if d is None:
                continue
            t = i / fps
            detections.append(
                FrameDetection(timestamp=t, x=d.x, y=d.y, color=color, area=d.area, confidence=d.confidence)
            )
    return detections


def stable_pointings(
    detections: list[FrameDetection],
    max_jump_px: float = MAX_JUMP_PX,
    min_duration: float = MIN_POINTING_DURATION_S,
    max_gap: float = MAX_GAP_S,
) -> list[dict]:
    """Regroupe les détections successives en clusters stables."""
    if not detections:
        return []

    clusters: list[list[FrameDetection]] = []
    current: list[FrameDetection] = []

    def flush(cluster: list[FrameDetection]):
        if not cluster:
            return
        duration = cluster[-1].timestamp - cluster[0].timestamp
        if duration < min_duration:
            return
        bx = float(np.mean([d.x for d in cluster]))
        by = float(np.mean([d.y for d in cluster]))
        clusters.append(cluster)  # placeholder, on convertit plus bas

    for det in detections:
        if not current:
            current = [det]
            continue
        bx = float(np.mean([d.x for d in current]))
        by = float(np.mean([d.y for d in current]))
        last_t = current[-1].timestamp
        dist = ((det.x - bx) ** 2 + (det.y - by) ** 2) ** 0.5
        if (det.timestamp - last_t) > max_gap or dist > max_jump_px:
            flush(current)
            current = [det]
        else:
            current.append(det)
    flush(current)

    pointings = []
    for cluster in clusters:
        bx = float(np.mean([d.x for d in cluster]))
        by = float(np.mean([d.y for d in cluster]))
        pointings.append(
            {
                "t_start": cluster[0].timestamp,
                "t_end": cluster[-1].timestamp,
                "t_center": (cluster[0].timestamp + cluster[-1].timestamp) / 2,
                "duration": cluster[-1].timestamp - cluster[0].timestamp,
                "x_pixel": bx,
                "y_pixel": by,
                "n_frames": len(cluster),
                "color": cluster[0].color,
            }
        )
    return pointings


def project_pointings_to_cells(
    pointings: list[dict], calibration: dict, tableau: dict, dbg: DebugLogger
) -> list[dict]:
    """Ajoute case_id_geometrique à chaque pointage via l'homographie."""
    H = np.array(calibration["homography_image_to_grid"], dtype=np.float64)
    rows = tableau["rows"]
    cols = tableau["cols"]
    out = []
    for p in pointings:
        row, col, gx, gy = pixel_to_cell(p["x_pixel"], p["y_pixel"], H, rows, cols)
        case_id = None
        label = None
        if row is not None and col is not None:
            cell = tableau["cells"][row][col]
            case_id = cell["id"]
            label = cell["label"]
        out.append({**p, "row": row, "col": col, "grid_xy": [gx, gy], "case_id_geometrique": case_id, "label": label})
    dbg.log(
        "projection pointages → cases",
        nb_total=len(out),
        nb_dans_grille=sum(1 for p in out if p["case_id_geometrique"] is not None),
    )
    return out


def align_pointings_with_audio(pointings: list[dict], segments: list[dict]) -> list[dict]:
    """
    Pour chaque pointage, attache les segments audio dont l'intervalle [start,end]
    chevauche [t_start, t_end] (avec une marge ±0.5s).
    """
    out = []
    for p in pointings:
        t0 = p["t_start"] - 0.5
        t1 = p["t_end"] + 0.5
        matched = [s for s in segments if not (s["end"] < t0 or s["start"] > t1)]
        out.append({**p, "audio_segments": matched})
    return out


def run_pipeline(
    video_src: Path, session_dir: Path, calibration: dict, tableau: dict
) -> dict[str, Any]:
    session_dir.mkdir(parents=True, exist_ok=True)
    dbg = DebugLogger(session_dir / "debug.log")
    try:
        video_dst = session_dir / ("video" + Path(video_src).suffix.lower())
        if video_src.resolve() != video_dst.resolve():
            shutil.copy2(video_src, video_dst)
        dbg.log("session démarrée", session_id=session_dir.name, video=str(video_dst.name))

        audio_path = session_dir / "audio.wav"
        frames_dir = session_dir / "frames"
        extract_audio(video_dst, audio_path, dbg)
        extract_frames(video_dst, frames_dir, dbg, fps=FRAMES_FPS)

        frame_paths = _list_frames(frames_dir)
        if not frame_paths:
            raise RuntimeError("aucune frame extraite — vidéo invalide ?")

        # Choix couleur sur un échantillon de frames (max 30 régulièrement espacées).
        sample_idx = np.linspace(0, len(frame_paths) - 1, min(30, len(frame_paths))).astype(int)
        sample = [cv2.imread(str(frame_paths[i])) for i in sample_idx]
        sample = [s for s in sample if s is not None]
        with dbg.step("évaluation couleur de pastille"):
            color, color_stats = best_color_over_frames(sample)
        dbg.log("stats couleur", **color_stats, choix=color)

        if color is None:
            raise RuntimeError(
                "Pastille fluo non détectée — vérifier l'éclairage ou changer de couleur de pastille"
            )

        detections = detect_marker_on_frames(frame_paths, color, FRAMES_FPS, dbg)
        dbg.log("détections totales", nb=len(detections))

        pointings = stable_pointings(detections)
        dbg.log("pointages stables", nb=len(pointings))

        pointings = project_pointings_to_cells(pointings, calibration, tableau, dbg)

        with dbg.step(f"transcription Whisper ({os.getenv('WHISPER_MODEL', 'medium')})"):
            transcript = transcribe(audio_path)
        dbg.log("transcription", chars=len(transcript["text"]), nb_segments=len(transcript["segments"]))

        pointings = align_pointings_with_audio(pointings, transcript["segments"])

        result = {
            "session_id": session_dir.name,
            "video_filename": video_dst.name,
            "couleur_pastille_detectee": color,
            "color_stats": color_stats,
            "pointages": pointings,
            "audio_transcript": transcript,
            "case_sequence": [p["case_id_geometrique"] for p in pointings],
            "label_sequence": [p["label"] for p in pointings],
            "propositions": [],  # rempli à l'itération 4 (Claude)
        }
        (session_dir / "result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        dbg.log("session terminée — result.json écrit")
        return result
    finally:
        dbg.close()
