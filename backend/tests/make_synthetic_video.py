"""
Génère une vidéo synthétique pour tester le pipeline sans Yoni.

Crée :
  - une image PNG du tableau (pour la calibration),
  - une vidéo MP4 où une pastille fuchsia se déplace sur 5 positions correspondant
    à des cases du tableau, avec des pauses de ~1s sur chacune.

Sortie : data/test/photo.png + data/test/video.mp4 (audio silencieux ajouté via ffmpeg).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from static_ffmpeg import add_paths as _ffmpeg_add_paths
import shutil

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from homography import cells_to_bboxes, compute_homographies  # noqa: E402

_ffmpeg_add_paths()
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"


def draw_grid(img: np.ndarray, corners: list[tuple[int, int]], rows: int, cols: int, tableau: dict):
    H_i2g, H_g2i = compute_homographies(corners, rows, cols)
    bboxes = cells_to_bboxes(tableau, H_g2i)
    for cell in bboxes:
        pts = np.array(cell["corners"], np.int32).reshape(-1, 1, 2)
        cv2.polylines(img, [pts], True, (60, 60, 60), 1)
        cx, cy = cell["center"]
        cv2.putText(
            img, cell["label"], (int(cx) - 12, int(cy) + 6),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 40, 40), 1, cv2.LINE_AA,
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(ROOT / "data" / "test"))
    ap.add_argument("--seq", default="m,e_grave,r,s,i", help="ids de cases à pointer")
    args = ap.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    tableau = json.loads((ROOT / "backend" / "tableau.json").read_text(encoding="utf-8"))
    rows, cols = tableau["rows"], tableau["cols"]

    W, H = 800, 600
    # Coins du tableau dans l'image (perspective légère pour réalisme).
    corners = [(120, 80), (700, 100), (680, 540), (140, 520)]

    # 1. Image calibration (sans la pastille).
    photo = np.full((H, W, 3), 248, dtype=np.uint8)
    pts = np.array(corners, np.int32)
    cv2.fillPoly(photo, [pts], (255, 255, 255))
    draw_grid(photo, corners, rows, cols, tableau)
    photo_path = out / "photo.png"
    cv2.imwrite(str(photo_path), photo)
    print(f"photo : {photo_path}")

    # 2. Vidéo avec pastille fuchsia se déplaçant sur la séquence.
    H_i2g, H_g2i = compute_homographies(corners, rows, cols)
    bboxes = cells_to_bboxes(tableau, H_g2i)
    by_id = {c["id"]: c for c in bboxes}

    seq_ids = [s.strip() for s in args.seq.split(",") if s.strip()]
    targets = []
    for cid in seq_ids:
        if cid not in by_id:
            print(f"id inconnu: {cid} — connus: {list(by_id)[:10]}…")
            sys.exit(1)
        targets.append(by_id[cid]["center"])

    fps = 30
    pause_frames = 30   # 1.0s par case
    travel_frames = 12  # ~0.4s entre cases

    raw_video = out / "video_silent.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    vw = cv2.VideoWriter(str(raw_video), fourcc, fps, (W, H))

    bg = photo.copy()

    def write_with_dot(x: float, y: float):
        frame = bg.copy()
        # Pastille fuchsia (BGR ~ (255, 0, 255) sature trop ; on choisit du fluo)
        cv2.circle(frame, (int(x), int(y)), 14, (180, 0, 220), -1)  # B,G,R
        cv2.circle(frame, (int(x), int(y)), 14, (255, 100, 255), 2)
        vw.write(frame)

    # Position de départ en haut à gauche, hors tableau.
    prev = (60.0, 60.0)
    for tgt in targets:
        # Trajet
        for k in range(travel_frames):
            a = (k + 1) / travel_frames
            x = prev[0] + (tgt[0] - prev[0]) * a
            y = prev[1] + (tgt[1] - prev[1]) * a
            write_with_dot(x, y)
        # Pause sur la cible (avec léger jitter <2px pour réalisme)
        for k in range(pause_frames):
            jx = (np.random.rand() - 0.5) * 3
            jy = (np.random.rand() - 0.5) * 3
            write_with_dot(tgt[0] + jx, tgt[1] + jy)
        prev = tgt
    vw.release()
    print(f"vidéo silencieuse : {raw_video}")

    # 3. Ajout d'une piste audio silencieuse pour Whisper.
    final_video = out / "video.mp4"
    cmd = [
        FFMPEG, "-y",
        "-i", str(raw_video),
        "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
        "-shortest",
        "-c:v", "copy",
        "-c:a", "aac",
        str(final_video),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print("ffmpeg err:", proc.stderr[-400:])
        sys.exit(1)
    raw_video.unlink()
    print(f"vidéo finale : {final_video}")
    print(f"séquence pointée : {' → '.join(seq_ids)}")
    print(f"calibration corners (TL,TR,BR,BL) : {corners}")
    print(f"image size : {W}x{H}")


if __name__ == "__main__":
    main()
