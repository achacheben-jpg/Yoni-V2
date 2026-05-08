"""
Calcul d'homographie tableau ↔ image et bbox de chaque case.

Étant donné les 4 coins du tableau dans l'image (TL, TR, BR, BL en pixels) et la définition
du tableau (rows × cols), on calcule :
  - H_image_to_grid : matrice 3x3 qui mappe un point image (x_px, y_px) vers la grille
    normalisée (gx ∈ [0, cols], gy ∈ [0, rows]).
  - les 4 coins en pixels et le centre de chaque case.

Pour mapper un pointage en pixel → case :
    gx, gy = perspectiveTransform([(x_px, y_px)], H_image_to_grid)
    col = int(floor(gx)), row = int(floor(gy))
    case_id = tableau.cells[row][col].id   (si 0 ≤ col < cols et 0 ≤ row < rows)
"""
from __future__ import annotations

from typing import TypedDict

import cv2
import numpy as np

Point = tuple[float, float]


class CellBBox(TypedDict):
    id: str
    label: str
    type: str
    row: int
    col: int
    corners: list[list[float]]  # [[x,y]] x 4, ordre TL,TR,BR,BL en pixels
    center: list[float]


def compute_homographies(
    corners_image: list[Point], rows: int, cols: int
) -> tuple[np.ndarray, np.ndarray]:
    """
    corners_image : 4 points (TL, TR, BR, BL) en pixels image.
    Retourne (H_image_to_grid, H_grid_to_image).
    """
    if len(corners_image) != 4:
        raise ValueError("4 coins exactement attendus (TL, TR, BR, BL)")

    src = np.array(corners_image, dtype=np.float32)
    dst = np.array(
        [[0, 0], [cols, 0], [cols, rows], [0, rows]],
        dtype=np.float32,
    )
    H_image_to_grid = cv2.getPerspectiveTransform(src, dst)
    H_grid_to_image = cv2.getPerspectiveTransform(dst, src)
    return H_image_to_grid, H_grid_to_image


def cells_to_bboxes(
    tableau: dict, H_grid_to_image: np.ndarray
) -> list[CellBBox]:
    """Pour chaque case du tableau, calcule ses 4 coins et son centre dans l'image."""
    rows = tableau["rows"]
    cols = tableau["cols"]
    bboxes: list[CellBBox] = []
    for r in range(rows):
        for c in range(cols):
            cell = tableau["cells"][r][c]
            grid_corners = np.array(
                [
                    [c, r],
                    [c + 1, r],
                    [c + 1, r + 1],
                    [c, r + 1],
                ],
                dtype=np.float32,
            ).reshape(-1, 1, 2)
            img_corners = cv2.perspectiveTransform(grid_corners, H_grid_to_image).reshape(-1, 2)
            cx = float(img_corners[:, 0].mean())
            cy = float(img_corners[:, 1].mean())
            bboxes.append(
                CellBBox(
                    id=cell["id"],
                    label=cell["label"],
                    type=cell["type"],
                    row=r,
                    col=c,
                    corners=[[float(p[0]), float(p[1])] for p in img_corners],
                    center=[cx, cy],
                )
            )
    return bboxes


def pixel_to_cell(
    x: float, y: float, H_image_to_grid: np.ndarray, rows: int, cols: int
) -> tuple[int | None, int | None, float, float]:
    """
    Convertit un pixel (x, y) en (row, col) via l'homographie. Retourne (row, col, gx, gy).
    Si le point est hors-grille, row et col valent None.
    """
    pt = np.array([[[x, y]]], dtype=np.float32)
    out = cv2.perspectiveTransform(pt, H_image_to_grid).reshape(-1)
    gx, gy = float(out[0]), float(out[1])
    col = int(np.floor(gx)) if 0 <= gx < cols else None
    row = int(np.floor(gy)) if 0 <= gy < rows else None
    return row, col, gx, gy
