import { useEffect, useState } from "react";

type CalibrationState = { calibrated: boolean; [k: string]: unknown };

export default function App() {
  const [health, setHealth] = useState<{ status: string; anthropic_key_present: boolean } | null>(null);
  const [calib, setCalib] = useState<CalibrationState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/calibration").then((r) => r.json()),
    ])
      .then(([h, c]) => {
        setHealth(h);
        setCalib(c);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const isCalibrated = !!calib?.calibrated;

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
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
          <p className="text-sm text-slate-600">
            Itération 2 — upload photo zénithale du tableau, click sur 4 coins, calcul de l'homographie.
          </p>
        </Section>

        <Section title="2. Session" defaultOpen={isCalibrated}>
          <p className="text-sm text-slate-600">
            Itération 2-3 — démarrage de la session, upload vidéo, lancement du pipeline.
          </p>
          <button
            disabled
            title={isCalibrated ? "À implémenter en itération 2" : "Calibrer d'abord"}
            className="mt-3 px-4 py-2 rounded bg-slate-300 text-slate-600 text-sm cursor-not-allowed"
          >
            ▶ Démarrer la session
          </button>
        </Section>

        <Section title="3. Résultat" defaultOpen={false}>
          <p className="text-sm text-slate-600">
            Itération 4 — 5 propositions cliquables, champ correction, validation.
          </p>
        </Section>

        <Section title="4. Historique" defaultOpen={false}>
          <p className="text-sm text-slate-600">
            Itération 6 — phrases validées avec lecture vocale.
          </p>
        </Section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-400">
        v0.1.0 · itération 1 — squelette en place
      </footer>
    </div>
  );
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
