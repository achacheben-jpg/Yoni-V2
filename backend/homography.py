"""
Calcul d'homographie tableau ↔ image et bbox de chaque case.

Le tableau de Yoni est une grille IRRÉGULIÈRE (largeurs et hauteurs variables selon la
ligne, certaines cases fusionnées). On utilise donc une définition par bbox normalisé :
chaque case a son propre rectangle [x0, y0, x1, y1] dans [0,1]×[0,1] où (0,0) est le coin
haut-gauche du tableau et (1,1) le coin bas-droit (après calibration sur 4 coins).

H_image_to_norm   : pixel image (x_px, y_px) → coords normalisées (nx, ny) ∈ [0,1]²
H_norm_to_image   : coords normalisées → pixels (utile pour dessiner les bboxes en surimpression)

Pour mapper un pointage en pixel → case :
    nx, ny = perspectiveTransform([(x_px, y_px)], H_image_to_norm)
    pour chaque cell, si cell.bbox contient (nx, ny) → case_id = cell.id
"""
from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

import numpy as np

if TYPE_CHECKING:
    import cv2

Point = tuple[float, float]


class CellBBox(TypedDict):
    id: str
    label: str
    type: str
    bbox_norm: list[float]            # [x0, y0, x1, y1] dans [0,1]²
    corners: list[list[float]]         # 4 coins en pixels (TL, TR, BR, BL)
    center: list[float]                # centre en pixels


def compute_homographies(corners_image: list[Point]) -> tuple[np.ndarray, np.ndarray]:
    """
    corners_image : 4 points (TL, TR, BR, BL) en pixels image.
    Retourne (H_image_to_norm, H_norm_to_image) où l'espace normalisé est [0,1]×[0,1].
    """
    import cv2  # import paresseux

    if len(corners_image) != 4:
        raise ValueError("4 coins exactement attendus (TL, TR, BR, BL)")

    src = np.array(corners_image, dtype=np.float32)
    dst = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float32)
    H_image_to_norm = cv2.getPerspectiveTransform(src, dst)
    H_norm_to_image = cv2.getPerspectiveTransform(dst, src)
    return H_image_to_norm, H_norm_to_image


def cells_to_bboxes(tableau: dict, H_norm_to_image: np.ndarray) -> list[CellBBox]:
    """Pour chaque case du tableau, calcule ses 4 coins et son centre dans l'image."""
    import cv2  # import paresseux

    bboxes: list[CellBBox] = []
    for cell in tableau["cells"]:
        x0, y0, x1, y1 = cell["bbox"]
        norm_corners = np.array(
            [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
            dtype=np.float32,
        ).reshape(-1, 1, 2)
        img_corners = cv2.perspectiveTransform(norm_corners, H_norm_to_image).reshape(-1, 2)
        cx = float(img_corners[:, 0].mean())
        cy = float(img_corners[:, 1].mean())
        bboxes.append(
            CellBBox(
                id=cell["id"],
                label=cell["label"],
                type=cell.get("type", "mot"),
                bbox_norm=[float(v) for v in cell["bbox"]],
                corners=[[float(p[0]), float(p[1])] for p in img_corners],
                center=[cx, cy],
            )
        )
    return bboxes


def pixel_to_cell(
    x: float, y: float, H_image_to_norm: np.ndarray, tableau: dict
) -> tuple[str | None, str | None, float, float]:
    """
    Convertit un pixel (x, y) en (case_id, label, nx, ny). Si le point n'est dans aucune
    case, retourne (None, None, nx, ny).
    """
    import cv2  # import paresseux

    pt = np.array([[[x, y]]], dtype=np.float32)
    out = cv2.perspectiveTransform(pt, H_image_to_norm).reshape(-1)
    nx, ny = float(out[0]), float(out[1])

    for cell in tableau["cells"]:
        x0, y0, x1, y1 = cell["bbox"]
        if x0 <= nx < x1 and y0 <= ny < y1:
            return cell["id"], cell["label"], nx, ny
    return None, None, nx, ny
