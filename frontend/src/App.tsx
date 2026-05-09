import { useCallback, useEffect, useState } from "react";
import { Calibration } from "./components/Calibration";
import { Session } from "./components/Session";
import { Result } from "./components/Result";
import type { ProcessResult } from "./types";

type CalibrationState = {
  calibrated: boolean;
  image_filename?: string;
  image_size?: { w: number; h: number };
  nb_cases?: number;
  cells?: {
    id: string;
    label: string;
    type: string;
    bbox_norm: [number, number, number, number];
    corners: [number, number][];
    center: [number, number];
  }[];
};

type HistoryEntry = {
  timestamp: string;
  session_id: string;
  phrase_finale: string;
};

export default function App() {
  const [health, setHealth] = useState<{ status: string; anthropic_key_present: boolean } | null>(null);
  const [calib, setCalib] = useState<CalibrationState | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/calibration").then((r) => r.json()),
      fetch("/api/history").then((r) => r.json()),
    ])
      .then(([h, c, hist]) => {
        setHealth(h);
        setCalib(c);
        setHistory(hist.sessions || []);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => reload(), [reload]);

  const isCalibrated = !!calib?.calibrated;

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold">Yoni — reconstruction de phrases</h1>
            <p className="text-sm text-slate-500">
              Tableau phonétique filmé · pointage à la pastille fluo · transcription audio · Claude
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge ok={!!health}>API {health ? "en ligne" : "hors-ligne"}</Badge>
            <Badge ok={!!health?.anthropic_key_present}>
              Clé Anthropic {health?.anthropic_key_present ? "présente" : "absente"}
            </Badge>
            <Badge ok={isCalibrated}>{isCalibrated ? "Calibré" : "Non calibré"}</Badge>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto max-w-6xl px-4 mt-4">
          <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800">
            Erreur : {error}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6 grid gap-6 lg:grid-cols-2">
        <Section title="1. Calibration" defaultOpen={!isCalibrated}>
          <Calibration data={calib} onChanged={reload} />
        </Section>

        <Section title="2. Session" defaultOpen={isCalibrated}>
          <Session calibrated={isCalibrated} onResult={setResult} />
        </Section>

        <Section title="3. Résultat" defaultOpen={!!result}>
          {result ? (
            <Result result={result} onValidated={() => reload()} />
          ) : (
            <p className="text-sm text-slate-500">Démarre une session pour voir les propositions ici.</p>
          )}
        </Section>

        <Section title="4. Historique" defaultOpen={false}>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune phrase validée pour l'instant.</p>
          ) : (
            <ul className="text-sm divide-y divide-slate-100">
              {history
                .slice()
                .reverse()
                .map((h) => (
                  <li key={h.session_id + h.timestamp} className="py-2 flex items-center gap-2">
                    <span className="text-slate-400 font-mono text-xs flex-shrink-0">
                      {h.timestamp.slice(0, 19).replace("T", " ")}
                    </span>
                    <span className="flex-1 break-words">{h.phrase_finale}</span>
                    <button
                      onClick={() => speakFr(h.phrase_finale)}
                      className="px-2 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 flex-shrink-0"
                      title="Lire à voix haute"
                    >
                      🔊 Lire
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-400">
        v0.4.0 · itération 4 — reconstruction Claude + UI résultat
      </footer>
    </div>
  );
}

function speakFr(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    alert("Lecture vocale non supportée par ce navigateur.");
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  // Choisit une voix française si disponible.
  const fr = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("fr"));
  if (fr) u.voice = fr;
  window.speechSynthesis.speak(u);
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 " +
        (ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800")
      }
    >
      <span className={"h-1.5 w-1.5 rounded-full " + (ok ? "bg-green-500" : "bg-amber-500")} />
      {children}
    </span>
  );
}

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <h2 className="font-semibold">{title}</h2>
        <span className="text-slate-400 text-sm">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
