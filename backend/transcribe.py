"""
Wrapper léger autour de faster-whisper. Charge le modèle une seule fois.

Le modèle est téléchargé depuis HuggingFace au premier appel et mis en cache
dans ~/.cache/huggingface/. Aucun appel à un service en ligne (OpenAI ou autre)
au moment de l'inférence — tout tourne en local.

Variable d'environnement WHISPER_MODEL (défaut: medium).
Pour les tests rapides, mettre WHISPER_MODEL=tiny (~75 MB, très rapide).
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from faster_whisper import WhisperModel

_lock = threading.Lock()
_model: "WhisperModel | None" = None
_model_size: str | None = None


class Segment(TypedDict):
    text: str
    start: float
    end: float


class TranscriptionResult(TypedDict):
    text: str
    language: str
    segments: list[Segment]


def _get_model() -> "WhisperModel":
    global _model, _model_size
    size = os.getenv("WHISPER_MODEL", "medium")
    with _lock:
        if _model is None or _model_size != size:
            # Import paresseux : éviter le coût RAM tant qu'on n'appelle pas vraiment Whisper.
            from faster_whisper import WhisperModel
            _model = WhisperModel(size, device="cpu", compute_type="int8")
            _model_size = size
    return _model


def transcribe(audio_path: Path | str, language: str = "fr") -> TranscriptionResult:
    model = _get_model()
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        beam_size=5,
        vad_filter=True,
    )
    segments: list[Segment] = []
    full_text_parts: list[str] = []
    for s in segments_iter:
        segments.append(Segment(text=s.text.strip(), start=float(s.start), end=float(s.end)))
        full_text_parts.append(s.text)
    return TranscriptionResult(
        text=" ".join(p.strip() for p in full_text_parts).strip(),
        language=info.language or language,
        segments=segments,
    )
