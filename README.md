# Yoni v2 — reconstruction de phrases via tableau phonétique filmé

Une application monopage qui reconstruit des phrases françaises à partir d'une vidéo où une personne pointe sur les cases d'un tableau phonétique avec une pastille fluorescente, en lisant chaque case à voix haute.

## Pipeline

1. **Calibration** : photo zénithale du tableau + 4 coins → homographie + bbox de chaque case (`tableau.json` définit la grille).
2. **Session** : enregistrement vidéo (ou upload .mov/.mp4) → backend FastAPI.
3. **Pipeline backend** :
   - Extraction frames 10 fps (ffmpeg)
   - Extraction audio 16 kHz mono (ffmpeg)
   - Transcription audio (Whisper, modèle local)
   - Détection pastille fluo : essaie **fuchsia** d'abord, **vert fluo** en fallback (HSV / OpenCV)
   - Pointages stables (>0,4 s, mouvement <15 px) → projection homographique → case
   - Correcteur k-NN sur `corrections.jsonl` (5 plus proches voisins en pixel, vote majoritaire >60 %)
   - Alignement pointages ↔ transcription audio (timestamps Whisper)
   - Reconstruction par Claude Sonnet 4.5 → 5 propositions JSON
4. **Apprentissage** : la phrase validée par l'humain alimente le few-shot Claude et le k-NN au cycle suivant.

## Lancement

### Pré-requis

- macOS / Linux
- Python 3.9+
- Node.js 20+ (LTS — installé dans ce projet via `nvm`)

### Première installation

```bash
# Backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install && cd ..

# Clé Anthropic
cp .env.example .env.local
# Éditer .env.local et y mettre la clé ANTHROPIC_API_KEY
```

### Démarrage en dev (deux terminaux)

```bash
# Terminal 1 — backend (port 8000)
source .venv/bin/activate
cd backend && uvicorn app:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — frontend (port 5173)
cd frontend && npm run dev
```

Ouvrir <http://localhost:5173>. Les requêtes `/api/*` sont proxifiées vers le backend (configuration dans `frontend/vite.config.ts`).

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | _(obligatoire à l'itération 4)_ | clé API Anthropic |
| `CLAUDE_MODEL` | `claude-sonnet-4-5` | modèle Claude utilisé |
| `WHISPER_MODEL` | `medium` | taille du modèle Whisper (`tiny`, `base`, `small`, `medium`, `large-v3`) |

## Arborescence

```
.
├── backend/
│   ├── app.py                  # FastAPI (entrée principale)
│   ├── tableau.json            # définition de la grille phonétique (modifiable)
│   ├── detect_fluo_marker.py   # détection pastille fuchsia / vert fluo
│   └── requirements.txt
├── frontend/                    # Vite + React + TS + Tailwind v4
├── data/
│   ├── calibration/            # calibration.json + photo de référence
│   ├── sessions/<uuid>/        # video.mov, audio.wav, frames/, debug.log, result.json
│   ├── corrections.jsonl       # corrections humaines (apprentissage)
│   └── models/                 # modèles Whisper (auto-téléchargés)
├── .env.example
├── .gitignore
└── README.md
```

## Logs serveur

Pour chaque session, un fichier `data/sessions/<uuid>/debug.log` détaille toutes les étapes du pipeline et leurs durées.

## Notes d'implémentation

### Pourquoi pas Homebrew / whisper.cpp / ffmpeg système

Le poste cible n'avait ni Homebrew ni Xcode complet : on évite ainsi tout `sudo`. À la place :

- **ffmpeg** : binaire fourni par le package Python `imageio-ffmpeg` (chemin obtenu via `imageio_ffmpeg.get_ffmpeg_exe()`).
- **Whisper** : `faster-whisper` (basé sur CTranslate2, MIT, totalement local — aucun appel à un service OpenAI). Modèle téléchargé depuis HuggingFace au premier appel et mis en cache dans `~/.cache/huggingface/`.
- **Node.js** : installé via **nvm** dans `~/.nvm/`.

Si tu préfères whisper.cpp / ffmpeg système, le code est isolé derrière deux modules (`pipeline.py` / `transcribe.py` à venir aux itérations 3) et la bascule est triviale.

### shadcn/ui

L'itération 1 part en Tailwind v4 brut (Tailwind v4 + plugin Vite, zéro PostCSS) sans shadcn pour minimiser les dépendances. Les composants UI customs sont volontairement minimalistes (`<Section>`, `<Badge>`). L'ajout de shadcn est trivial si nécessaire à une itération ultérieure.

### Modèle Claude

Le code utilise `claude-sonnet-4-5` par défaut. Modifiable via la variable `CLAUDE_MODEL`.
