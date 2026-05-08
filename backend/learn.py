"""
Apprentissage par corrections humaines.

Deux usages des données stockées dans data/corrections.jsonl :
  1. Few-shot Claude : les 30 dernières corrections sont injectées dans le prompt
     (géré dans claude_reconstruct.py).
  2. Correcteur k-NN géométrique : pour chaque pointage (x, y), on cherche les
     5 plus proches voisins en pixel parmi tous les pointages historiques. Si une
     case ressort en majorité (>60%), on la préfère à la case calculée par homographie.

Format d'une ligne corrections.jsonl :
{
  "timestamp": "2026-...",
  "session_id": "...",
  "phrase_finale": "merci",
  "phrase_proposee_n1": "merci",
  "phrase_humaine_corrigee": null,    // ou la valeur si l'humain a corrigé
  "pointages": [
    {"x": 320, "y": 410, "case_id_geometrique": "m", "timestamp": 3.2}, ...
  ],
  "audio_transcript": "..."
}
"""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class HistoricalPoint:
    x: float
    y: float
    case_id: str


def load_historical_points(corrections_path: Path) -> list[HistoricalPoint]:
    """Lit toutes les lignes de corrections.jsonl et extrait (x, y, case_id) de chaque pointage."""
    if not corrections_path.exists():
        return []
    points: list[HistoricalPoint] = []
    for line in corrections_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        for p in obj.get("pointages", []):
            x = p.get("x") or p.get("x_pixel")
            y = p.get("y") or p.get("y_pixel")
            cid = p.get("case_corrigee") or p.get("case_id_geometrique") or p.get("case_id")
            if x is None or y is None or cid is None:
                continue
            points.append(HistoricalPoint(float(x), float(y), str(cid)))
    return points


def knn_correct(
    x: float,
    y: float,
    historical: list[HistoricalPoint],
    k: int = 5,
    min_confidence: float = 0.60,
) -> tuple[str | None, float]:
    """
    Retourne (case_id_corrigee, confiance) si une case majoritaire dépasse min_confidence
    parmi les k plus proches voisins. Sinon (None, 0.0).
    """
    if len(historical) < k:
        return None, 0.0
    distances = sorted(
        ((p, (p.x - x) ** 2 + (p.y - y) ** 2) for p in historical),
        key=lambda t: t[1],
    )[:k]
    counts = Counter(p.case_id for p, _ in distances)
    case_id, n = counts.most_common(1)[0]
    confidence = n / k
    if confidence >= min_confidence:
        return case_id, confidence
    return None, confidence


def apply_knn_to_pointings(pointings: list[dict], corrections_path: Path) -> tuple[list[dict], dict]:
    """
    Applique le correcteur k-NN à chaque pointage. Renvoie (nouveaux pointages, stats).
    Chaque pointage reçoit case_id_corrigee et confiance_knn.
    """
    historical = load_historical_points(corrections_path)
    n_corrected = 0
    out = []
    for p in pointings:
        case_knn, conf = knn_correct(p["x_pixel"], p["y_pixel"], historical)
        case_geom = p.get("case_id_geometrique")
        case_final = case_knn or case_geom
        was_corrected = bool(case_knn) and case_knn != case_geom
        if was_corrected:
            n_corrected += 1
        out.append(
            {
                **p,
                "case_id_corrigee": case_final,
                "knn_confiance": conf,
                "knn_a_corrige": was_corrected,
            }
        )
    stats = {
        "nb_historiques": len(historical),
        "nb_pointages": len(pointings),
        "nb_corriges_par_knn": n_corrected,
    }
    return out, stats


def append_correction(
    corrections_path: Path,
    *,
    session_id: str,
    phrase_finale: str,
    phrase_proposee_n1: str | None,
    phrase_humaine_corrigee: str | None,
    pointages: list[dict],
    audio_transcript: str,
    label_sequence: list[str | None] | None = None,
) -> dict:
    """Append une ligne JSON dans corrections.jsonl."""
    import time

    record = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "session_id": session_id,
        "phrase_finale": phrase_finale,
        "phrase_proposee_n1": phrase_proposee_n1,
        "phrase_humaine_corrigee": phrase_humaine_corrigee,
        "pointages": [
            {
                "x": p.get("x_pixel"),
                "y": p.get("y_pixel"),
                "timestamp": p.get("t_center", p.get("t_start")),
                "case_id_geometrique": p.get("case_id_geometrique"),
                "case_id_corrigee": p.get("case_id_corrigee", p.get("case_id_geometrique")),
                "case_corrigee": p.get("case_id_corrigee", p.get("case_id_geometrique")),
            }
            for p in pointages
        ],
        "audio_transcript": audio_transcript,
        "label_sequence": label_sequence or [],
    }
    with corrections_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record
