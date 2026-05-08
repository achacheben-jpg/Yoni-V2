# Yoni v2 — contexte projet

État au **9 mai 2026, 01:36**. Document à donner à toute nouvelle session pour reprendre le projet.

## 1. Objectif

Reconstruire des phrases françaises à partir d'une vidéo où une personne pointe sur les cases d'un tableau phonétique avec une pastille fluorescente, en lisant chaque case à voix haute.

Yoni est l'utilisateur final (communication adaptée). Ben (Dr Achache) est l'opérateur qui prépare/calibre.

## 2. Stack

| Couche | Techno | Pourquoi |
|---|---|---|
| Backend | FastAPI + uvicorn (Python 3.9, venv) | API REST, multipart |
| Vision | OpenCV (HSV) + homographie | Détection pastille + projection pixel→case |
| Audio | faster-whisper (CTranslate2, local, pas d'OpenAI) | Transcription FR |
| LLM | Anthropic SDK 0.100, modèle `claude-sonnet-4-5` | Reconstruction 5 propositions |
| Frontend | Vite + React 19 + TypeScript + Tailwind v4 | Mono-page, 4 sections |
| ffmpeg | `static-ffmpeg` (binaire ARM64 auto-téléchargé) | Pas de brew/sudo dispo |
| Node | nvm 24.15.0 LTS dans `~/.nvm/` | Idem |

**Aucune dépendance OpenAI / Docker / Homebrew.**

## 3. Pipeline /api/process

```
vidéo .mov/.mp4
  ↓
ffmpeg : audio.wav (16 kHz mono) + frames 10 fps
  ↓
détection couleur dominante : fuchsia → vert fluo en fallback (HSV OpenCV)
  ↓
détection pastille frame par frame
  ↓
pointages stables (>0.4 s, mouvement <15 px)
  ↓
projection homographique pixel → case via calibration.json
  ↓
correcteur k-NN : 5 plus proches voisins parmi corrections.jsonl, vote majoritaire >60 %
  ↓
transcription Whisper (modèle local, fr)
  ↓
appel Claude Sonnet 4.5 :
   • prompt système précis
   • séquence cases + transcription audio
   • 30 dernières corrections en few-shot
   → 5 propositions JSON ordonnées par probabilité
  ↓
result.json + debug.log dans data/sessions/<uuid>/
```

## 4. Endpoints

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/health` | Ping + état clé Anthropic |
| GET | `/api/tableau` | Définition du tableau phonétique |
| GET | `/api/calibration` | État calibration (incluant bboxes des cases) |
| POST | `/api/calibration` | multipart : `image`, `corners` (JSON 4 pts TL/TR/BR/BL), `image_size` |
| GET | `/api/calibration/image` | Sert la photo de calibration |
| DELETE | `/api/calibration` | Réinitialise |
| POST | `/api/process` | multipart : `video` → pipeline complet |
| POST | `/api/learn` | JSON : `session_id`, `phrase_finale`, `phrase_proposee_n1`, `phrase_humaine_corrigee` |
| GET | `/api/history` | Liste des phrases validées |
| POST | `/api/debug/detect` | multipart : `video` → diagnostic HSV sans pipeline |

## 5. Arborescence

```
.
├── backend/
│   ├── app.py                      FastAPI (point d'entrée, CORS, dotenv override=True)
│   ├── tableau.json                Grille phonétique 6×6, modifiable (phonèmes/pronoms/mots)
│   ├── homography.py               Calcul homographie + bboxes (cv2 lazy-import)
│   ├── detect_fluo_marker.py       Détection HSV fuchsia/vert fluo
│   ├── pipeline.py                 Orchestration ffmpeg + détection + Whisper + Claude
│   ├── transcribe.py               Wrapper faster-whisper (lazy import)
│   ├── claude_reconstruct.py       Prompt système + appel Anthropic SDK
│   ├── learn.py                    k-NN + append corrections.jsonl
│   ├── requirements.txt
│   └── tests/
│       ├── make_synthetic_video.py     Génère data/test/photo.png + video.mp4 (m,è,r,s,i)
│       ├── run_pipeline_test.py        Test E2E via TestClient
│       ├── run_pipeline_no_whisper.py  Test sans Whisper (RAM contrainte)
│       └── run_pipeline_direct.py      Test sans FastAPI
├── frontend/
│   ├── vite.config.ts              + plugin tailwindcss + proxy /api → 8000
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                 4 sections + lecture vocale Web Speech API
│   │   ├── index.css               @import "tailwindcss"
│   │   ├── types.ts                ProcessResult, Pointage
│   │   └── components/
│   │       ├── Calibration.tsx     Upload photo + clic 4 coins + overlay bboxes
│   │       ├── Session.tsx         MediaRecorder caméra/micro OU upload vidéo
│   │       └── Result.tsx          5 propositions cliquables + champ correction + accordion détails
│   └── package.json                Vite 8, React 19, Tailwind 4
├── data/
│   ├── calibration/calibration.json    + photo.png|jpg
│   ├── sessions/<uuid>/                video, audio.wav, frames/, debug.log, result.json
│   ├── corrections.jsonl               Apprentissage (1 ligne par phrase validée)
│   └── models/                         (vide, Whisper télécharge dans ~/.cache/huggingface)
├── .claude/launch.json             Config Claude Preview (frontend uniquement, voir §9)
├── .env.example
├── .env.local                      ANTHROPIC_API_KEY + WHISPER_MODEL=tiny
├── .gitignore
├── README.md
└── contexte.md                     ce fichier
```

## 6. Lancement

### Première fois
```bash
cd "/Users/benjaminachache/Documents/Yoni v2"
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh"
cd frontend && npm install && cd ..

cp .env.example .env.local   # éditer ANTHROPIC_API_KEY
```

### Démarrage normal (deux services en arrière-plan)
```bash
# Backend
source .venv/bin/activate
cd backend
nohup uvicorn app:app --host 127.0.0.1 --port 8000 > /tmp/yoni_backend.log 2>&1 &

# Frontend
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh"
cd frontend
nohup npm run dev > /tmp/yoni_frontend.log 2>&1 &

open http://localhost:5173
```

### Tout arrêter
```bash
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null
```

### Vidéo de test synthétique
```bash
source .venv/bin/activate
python backend/tests/make_synthetic_video.py
# → data/test/photo.png  (calibration)
# → data/test/video.mp4  (séquence "m,è,r,s,i" pour "merci", pastille fuchsia)
# Coins de calibration : (120,80) (700,100) (680,540) (140,520) — image 800×600
```

## 7. État de validation

### Validé bout-en-bout (9 mai 01:16)
| Composant | Statut |
|---|---|
| `/api/calibration` | ✅ 36 cases 6×6 |
| Détection fuchsia | ✅ 100 % sur vidéo synthétique |
| Pointages stables | ✅ 5 détectés |
| Projection homographique | ✅ séquence `m, è, r, s, i` |
| Whisper tiny | ✅ (silence détecté correctement) |
| Claude Sonnet 4.5 | ✅ propositions `['merci', 'mercy', 'mers si', 'mère si', 'mers y']` |
| `/api/learn` | ✅ corrections.jsonl mis à jour |
| Frontend Vite + Tailwind | ✅ port 5173 |
| Web Speech API (lecture vocale historique) | ✅ |

### Bugs corrigés (cf. git log)
| Hash | Description |
|---|---|
| `c8473bd` | Lazy-import faster_whisper (perf RAM contrainte) |
| `5bf9a2d` | Lazy-import cv2 dans homography.py + app.py |
| `42446cd` | `anthropic 0.39` → `0.100` (compat httpx) + `load_dotenv(override=True)` (Claude Desktop exporte `ANTHROPIC_API_KEY=""` vide) |
| `3a10506` | `launch.json` : retire backend (sandbox Preview ne peut pas accéder à `.venv/pyvenv.cfg` dans Documents — TCC) |
| `d06f61f` | `index.css` revenu au scaffold Vite (Tailwind absent) restauré + seuils HSV plus permissifs (S/V 50/90 au lieu de 80/120, MIN_AREA 40px, plage fuchsia + wraparound rouge) + seuil détection couleur 30 % → 15 % + endpoint `/api/debug/detect` |

## 8. Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | _(obligatoire)_ | <https://console.anthropic.com/settings/keys> |
| `CLAUDE_MODEL` | `claude-sonnet-4-5` | Modèle Claude |
| `WHISPER_MODEL` | `medium` (mais on utilise `tiny` actuellement) | `tiny` (75 Mo, rapide), `medium` (1,5 Go, précis), `large-v3` |

## 9. Particularités d'environnement

- **Pas de brew, pas de sudo, pas de Xcode complet** → `static-ffmpeg` (binaire ARM64 téléchargé), `nvm`, venv local.
- **macOS 15.6.1, ARM64**, Python 3.9.6 système.
- **RAM très contrainte** sur cette machine (~80–180 Mo libres parfois) : 1er run du pipeline = 15 min (Whisper tiny met 8 min à charger via paging). 2e run = 10 s (cache chaud). Fermer Asana/Adobe/Molotov/ChatGPT avant d'utiliser.
- **Disque** à ~93 % plein. Gros consommateurs identifiés (cf. messages précédents) : `~/Library/Application Support/Claude/vm_bundles` (20 Go), `~/Desktop/Raphaella/...mp4` (8 Go).
- **TCC Documents folder** : Claude Preview sandbox n'a pas accès à `.venv/pyvenv.cfg` → backend lancé en `nohup` séparément, pas via `preview_start`. Frontend OK via Preview. Le proxy Vite `/api/*` route vers `http://127.0.0.1:8000`.

## 10. Tableau phonétique (`backend/tableau.json`)

Grille 6×6 par défaut, modifiable :

```
A   E   I   O   U   OU
É   È   AN  ON  IN  EU
B   C   D   F   G   H
J   L   M   N   P   R
S   T   V   Z   CH  GN
je  tu  il  elle oui non
```

Schéma : `{ rows, cols, cells: [[{id, label, type: phoneme|mot|pronom}, ...], ...] }`. Les `id` sont ce que retourne le pipeline.

## 11. Apprentissage continu

Chaque clic "✓ Valider et apprendre" ajoute une ligne JSON dans `data/corrections.jsonl` :
```json
{
  "timestamp": "2026-05-09T01:16:50",
  "session_id": "...",
  "phrase_finale": "merci",
  "phrase_proposee_n1": "merci",
  "phrase_humaine_corrigee": null,
  "pointages": [{"x", "y", "timestamp", "case_id_geometrique", "case_id_corrigee"}, ...],
  "audio_transcript": "...",
  "label_sequence": [...]
}
```

Cette donnée alimente :
1. **k-NN géométrique** : à chaque nouveau pipeline, pour chaque pointage on cherche les 5 plus proches voisins en pixel, et si une case ressort à >60 %, elle est préférée à la case géométrique pure.
2. **Few-shot Claude** : les 30 dernières corrections sont injectées dans le prompt user comme exemples.

## 12. Diagnostic en cas de problème

### "Pastille fluo non détectée"
```bash
curl -X POST http://127.0.0.1:8000/api/debug/detect -F "video=@ta_video.mp4" | python3 -m json.tool
```
→ retourne ratio de détection par couleur, échantillon de détections, diagnostic en clair. Si même avec les seuils permissifs (post `d06f61f`) la pastille n'est pas vue, ajuster `HSV_RANGES` dans `backend/detect_fluo_marker.py`.

### "Clé Anthropic absente" malgré `.env.local`
Vérifier `env | grep ANTHROPIC` — si `ANTHROPIC_API_KEY=` (vide) est exporté par Claude Desktop, c'est masqué. Le fix `load_dotenv(override=True)` est en place depuis `42446cd`. Redémarrer le backend après modif du `.env.local`.

### Backend met >2 min à démarrer
Mémoire saturée. `vm_stat | head -3` doit donner Pages free ≥ 50 000. Sinon : redémarrer le Mac, ou fermer les grosses apps (Asana, Adobe, Molotov, Zoom).

### Whisper transcription vide ou mauvaise
- Modèle `tiny` est imprécis. Passer à `WHISPER_MODEL=medium` dans `.env.local` (1,5 Go au 1er run).
- VAD filter peut couper la voix si trop bas. Augmenter le volume d'enregistrement.

## 13. Commits actuels (10)

```
d06f61f fix: index.css revenu au scaffold + seuils HSV + /api/debug/detect
3a10506 fix(launch.json): retire backend (sandbox Preview)
42446cd fix: anthropic 0.39 → 0.100 + load_dotenv override + paths absolus
5bf9a2d perf: lazy-import cv2
c8473bd transcribe: lazy-import faster_whisper
3516d5e README — flux + vidéo de test
9032f44 Itération 4+5+6 — Claude + k-NN + UI complète + lecture vocale
5918eda Itération 3 — pipeline détection (validé m,è,r,s,i 100%)
03c8c91 Itération 2 — calibration end-to-end
6a8e922 Itération 1 — setup complet
```

## 14. À faire si on continue

- **Performance** : la machine actuelle est trop tendue. Soit upgrade RAM, soit déplacer le venv hors `Documents/` pour pouvoir utiliser `preview_start` du backend.
- **Tableau** : valider avec Ben que la grille 6×6 actuelle correspond au tableau physique de Yoni (ajuster `backend/tableau.json` si besoin).
- **Whisper** : passer à `medium` une fois le test Yoni concluant pour la qualité.
- **Pastille** : si la fluo de Ben n'est ni fuchsia ni vert fluo, ajouter une 3e couleur dans `HSV_RANGES` (orange fluo, jaune fluo).
- **Frontend** : ajouter shadcn/ui si on veut une UI plus polished (pas requis aujourd'hui).
- **Mobile** : tester en DevTools mode iPhone, les classes Tailwind sont là mais non vérifiées en pratique sur écran réel.
