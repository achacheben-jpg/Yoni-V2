"""
Détection d'une pastille fluorescente sur une frame.
Essaie d'abord FUCHSIA (rose magenta), puis VERT FLUO en backup.
Retourne le centre (x, y) du blob le plus grand au-dessus du seuil de surface.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

import cv2
import numpy as np

Color = Literal["fuchsia", "green_fluo"]

# Seuils HSV ajustés pour pastilles fluo. Modifiable selon l'éclairage.
# Note : OpenCV utilise H ∈ [0, 179], S et V ∈ [0, 255].
# Seuils volontairement permissifs (lumière maison réelle, pas studio).
HSV_RANGES = {
    "fuchsia": [
        # Magenta/fuchsia : H entre rouge (~140) et magenta (~175).
        (np.array([135, 50, 90]), np.array([179, 255, 255])),
        # Wraparound vers les rouges purs (H 0-10) qu'on retrouve sur certains fluos roses.
        (np.array([0, 80, 120]), np.array([10, 255, 255])),
    ],
    "green_fluo": [
        # Vert fluo : large plage Hue 30-90, S/V relâchés.
        (np.array([30, 50, 90]), np.array([90, 255, 255])),
    ],
}

# Surface minimale en pixels pour qu'un blob soit considéré comme la pastille.
# Réduit pour gérer les pastilles loin de la caméra ou petites.
MIN_AREA = 40
# Surface maximale (pour exclure les vastes zones colorées qui ne sont pas la pastille).
MAX_AREA = 80_000


@dataclass
class Detection:
    color: Color
    x: int
    y: int
    area: int
    confidence: float  # 0..1, basée sur la compacité du blob


def _detect_one_color(frame_bgr: np.ndarray, color: Color) -> Optional[Detection]:
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lo, hi in HSV_RANGES[color]:
        mask |= cv2.inRange(hsv, lo, hi)

    # Nettoyage morphologique pour réduire le bruit.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    best = None
    best_area = 0
    for c in contours:
        a = cv2.contourArea(c)
        if a < MIN_AREA or a > MAX_AREA:
            continue
        if a > best_area:
            best_area = a
            best = c

    if best is None:
        return None

    M = cv2.moments(best)
    if M["m00"] == 0:
        return None
    cx = int(M["m10"] / M["m00"])
    cy = int(M["m01"] / M["m00"])

    # Confiance basée sur la circularité (4πA/P²) — une pastille ronde donne ~1.
    perim = cv2.arcLength(best, True)
    circularity = (4 * np.pi * best_area / (perim * perim)) if perim > 0 else 0.0
    confidence = float(min(1.0, max(0.0, circularity)))

    return Detection(color=color, x=cx, y=cy, area=int(best_area), confidence=confidence)


def detect_marker(frame_bgr: np.ndarray, prefer: Color = "fuchsia") -> Optional[Detection]:
    """Tente fuchsia puis vert fluo. Retourne la première détection valide (ou None)."""
    order: list[Color] = [prefer, "green_fluo" if prefer == "fuchsia" else "fuchsia"]
    for color in order:
        d = _detect_one_color(frame_bgr, color)
        if d is not None:
            return d
    return None


def best_color_over_frames(frames: list[np.ndarray]) -> tuple[Optional[Color], dict]:
    """
    Évalue chaque couleur sur l'ensemble des frames et garde celle au meilleur taux de détection,
    à condition de dépasser 30%. Retourne (couleur, stats).
    """
    stats = {}
    for color in ("fuchsia", "green_fluo"):
        detected = sum(1 for f in frames if _detect_one_color(f, color) is not None)
        stats[color] = {"detected": detected, "ratio": detected / max(1, len(frames))}

    # Préférence fuchsia si elle dépasse seuil, sinon green_fluo.
    # Seuil relâché à 15 % : la pastille est souvent occultée par la main pendant les pointages.
    threshold = 0.15
    if stats["fuchsia"]["ratio"] >= threshold and stats["fuchsia"]["ratio"] >= stats["green_fluo"]["ratio"]:
        return "fuchsia", stats
    if stats["green_fluo"]["ratio"] >= threshold:
        return "green_fluo", stats
    return None, stats
