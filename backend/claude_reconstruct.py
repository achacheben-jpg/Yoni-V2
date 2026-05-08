"""
Reconstruit 5 propositions de phrase française à partir :
  - de la séquence de cases pointées (ids + labels)
  - de la transcription audio
  - des 30 dernières corrections humaines (few-shot)

Utilise l'API Anthropic (modèle claude-sonnet-4-5 par défaut).
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Iterable

from anthropic import Anthropic

log = logging.getLogger("yoni.claude")

DEFAULT_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-5")
MAX_FEW_SHOT = 30

SYSTEM_PROMPT = (
    "Tu reconstruis des phrases françaises à partir de pointages sur un tableau phonétique. "
    "Tu reçois une séquence de cases (phonèmes/mots/pronoms) et une transcription audio d'un humain "
    "qui a lu chaque case à voix haute pendant le pointage. La transcription audio est plus fiable "
    "que les pointages eux-mêmes. Produis 5 phrases françaises plausibles, ordonnées par probabilité. "
    "Réponds UNIQUEMENT en JSON strict : "
    "{\"propositions\": [\"...\", \"...\", \"...\", \"...\", \"...\"]}"
)


def _client() -> Anthropic:
    return Anthropic()  # lit ANTHROPIC_API_KEY


def _read_few_shot(corrections_path: Path, n: int = MAX_FEW_SHOT) -> list[dict]:
    if not corrections_path.exists():
        return []
    lines = corrections_path.read_text(encoding="utf-8").splitlines()
    out: list[dict] = []
    # On prend les n dernières lignes valides.
    for line in lines[-n * 2 :]:  # marge en cas de lignes corrompues
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out[-n:]


def _format_few_shot(examples: Iterable[dict]) -> str:
    parts: list[str] = []
    for ex in examples:
        labels = ex.get("label_sequence") or []
        audio = ex.get("audio_transcript") or ""
        if isinstance(audio, dict):
            audio = audio.get("text", "")
        phrase = ex.get("phrase_finale") or ex.get("phrase_humaine_corrigee") or ex.get("phrase_proposee_n1") or ""
        if not phrase:
            continue
        parts.append(
            f"Pointages: [{', '.join(labels)}] | Audio: '{audio}' | Phrase: '{phrase}'"
        )
    return "\n".join(parts)


def _format_user_message(
    case_ids: list[str | None],
    labels: list[str | None],
    audio_text: str,
    few_shot: list[dict],
) -> str:
    parts = [
        "Voici la séquence de cases pointées et la transcription audio.",
        f"Pointages (labels): [{', '.join(l or '?' for l in labels)}]",
        f"Pointages (ids): [{', '.join(i or '?' for i in case_ids)}]",
        f"Audio: '{audio_text or '(silence)'}'",
    ]
    fs = _format_few_shot(few_shot)
    if fs:
        parts.append("\nExemples de corrections passées (du plus ancien au plus récent) :")
        parts.append(fs)
    parts.append(
        "\nDonne les 5 phrases françaises les plus probables en JSON strict, "
        "format exact : {\"propositions\": [...]}"
    )
    return "\n".join(parts)


def _extract_json(text: str) -> dict | None:
    """Tente d'extraire un objet JSON même s'il y a du texte autour."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # bloc ```json ... ```
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # premier { ... } trouvé
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return None


def reconstruct(
    case_ids: list[str | None],
    labels: list[str | None],
    audio_text: str,
    corrections_path: Path,
    model: str = DEFAULT_MODEL,
) -> list[str]:
    """
    Renvoie une liste de 5 propositions (peut être plus courte si Claude renvoie moins).
    Lève RuntimeError si la clé est absente ou si l'appel échoue.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY absente — voir .env.local")

    few_shot = _read_few_shot(corrections_path)
    user_msg = _format_user_message(case_ids, labels, audio_text, few_shot)

    log.info("Claude call : modèle=%s, few-shot=%d, labels=%s", model, len(few_shot), labels)
    resp = _client().messages.create(
        model=model,
        max_tokens=600,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    text = "".join(block.text for block in resp.content if hasattr(block, "text"))
    data = _extract_json(text)
    if not data or "propositions" not in data:
        log.warning("réponse Claude non parsable : %r", text[:200])
        raise RuntimeError(f"réponse Claude non parsable : {text[:200]}")
    props = [str(p).strip() for p in data["propositions"] if str(p).strip()]
    return props[:5]
