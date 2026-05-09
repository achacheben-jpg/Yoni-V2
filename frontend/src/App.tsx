import { useCallback, useEffect, useState } from "react";
import { Calibration } from "./components/Calibration";
import { Session } from "./components/Session";
import { Result } from "./components/Result";
import { IconChevron, IconLeaf, IconSpeaker } from "./components/Icon";
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

type Tweaks = {
  density: "confortable" | "compact";
  accent: "sage" | "clay";
  speakAuto: boolean;
};

const TWEAKS_KEY = "yoni.tweaks.v1";
const DEFAULT_TWEAKS: Tweaks = { density: "confortable", accent: "sage", speakAuto: false };

function loadTweaks(): Tweaks {
  try {
    const raw = localStorage.getItem(TWEAKS_KEY);
    if (raw) return { ...DEFAULT_TWEAKS, ...JSON.parse(raw) };
  } catch {
    /* noop */
  }
  return DEFAULT_TWEAKS;
}

export default function App() {
  const [health, setHealth] = useState<{ status: string; anthropic_key_present: boolean } | null>(null);
  const [calib, setCalib] = useState<CalibrationState | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tweaks, setTweaks] = useState<Tweaks>(loadTweaks);

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

  // Applique les tweaks au DOM (densité + accent) + persiste.
  useEffect(() => {
    document.body.dataset.density = tweaks.density;
    const sage = tweaks.accent === "sage" ? "#6a8a6e" : "#b56a4a";
    document.documentElement.style.setProperty("--color-sage", sage);
    try {
      localStorage.setItem(TWEAKS_KEY, JSON.stringify(tweaks));
    } catch {
      /* noop */
    }
  }, [tweaks]);

  // Lecture vocale auto sur nouveau résultat (si activé dans Tweaks).
  useEffect(() => {
    if (tweaks.speakAuto && result?.propositions?.[0]) {
      speakFr(result.propositions[0]);
    }
  }, [result, tweaks.speakAuto]);

  const isCalibrated = !!calib?.calibrated;

  return (
    <div className="min-h-screen w-full">
      <header className="border-b" style={{ borderColor: "var(--color-rule)" }}>
        <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-tight">Yoni — atelier de phrases</h1>
            <p className="text-sm mt-1" style={{ color: "var(--color-ink-soft)" }}>
              tableau phonétique <span style={{ color: "var(--color-ink-faint)" }}>•</span> pastille
              fluo <span style={{ color: "var(--color-ink-faint)" }}>•</span> reconstruction Claude
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge ok={!!health}>API {health ? "en ligne" : "hors-ligne"}</Badge>
            <Badge ok={!!health?.anthropic_key_present}>
              Clé Anthropic {health?.anthropic_key_present ? "présente" : "absente"}
            </Badge>
            <Badge ok={isCalibrated}>{isCalibrated ? "calibré" : "non calibré"}</Badge>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto max-w-6xl px-6 mt-4">
          <div className="banner-error">Erreur : {error}</div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-6 py-8 grid gap-6 lg:grid-cols-2">
        <Section roman="I" title="Calibration" defaultOpen={!isCalibrated}>
          <Calibration data={calib} onChanged={reload} />
        </Section>

        <Section roman="II" title="Session" defaultOpen={isCalibrated}>
          <Session calibrated={isCalibrated} onResult={setResult} />
        </Section>

        <Section roman="III" title="Résultat" defaultOpen={!!result}>
          {result ? (
            <Result result={result} onValidated={() => reload()} />
          ) : (
            <p className="text-sm" style={{ color: "var(--color-ink-soft)" }}>
              Démarre une session pour voir les propositions ici.
            </p>
          )}
        </Section>

        <Section roman="IV" title="Historique" defaultOpen={false}>
          <Historique history={history} />
        </Section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-8 font-mono text-[11px]" style={{ color: "var(--color-ink-faint)" }}>
        v0.4.0 · itération 4 — reconstruction Claude + UI résultat
      </footer>

      {import.meta.env.DEV && <TweaksPanel tweaks={tweaks} setTweaks={setTweaks} />}
    </div>
  );
}

/* ============================================================ */
/*  Header status badge                                          */
/* ============================================================ */
function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className="pill"
      style={{
        background: ok ? "var(--color-sage-soft)" : "var(--color-clay-soft)",
        color: "var(--color-ink)",
      }}
    >
      <span
        className="pill-dot"
        style={{ background: ok ? "var(--color-sage)" : "var(--color-clay)" }}
      />
      {children}
    </span>
  );
}

/* ============================================================ */
/*  Section accordéon                                            */
/* ============================================================ */
function Section({
  roman,
  title,
  defaultOpen,
  children,
}: {
  roman: string;
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  return (
    <section className="section-card">
      <button onClick={() => setOpen((v) => !v)} className="section-toggle">
        <span className="flex items-center">
          <span className="section-roman">{roman}.</span>
          <span>{title}</span>
        </span>
        <IconChevron size={18} className="chevron" data-open={open} />
      </button>
      {open && <div className="section-content">{children}</div>}
    </section>
  );
}

/* ============================================================ */
/*  Historique (timeline)                                        */
/* ============================================================ */
function Historique({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <div className="flex items-center gap-3 py-2">
        <div
          className="flex items-center justify-center"
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "var(--color-sage-soft)",
            color: "var(--color-sage)",
          }}
        >
          <IconLeaf size={22} />
        </div>
        <div
          className="font-display italic text-sm"
          style={{ color: "var(--color-ink-soft)" }}
        >
          aucune phrase encore — la première session apparaîtra ici
        </div>
      </div>
    );
  }

  return (
    <ol className="relative">
      {history
        .slice()
        .reverse()
        .map((h) => {
          const date = h.timestamp.slice(0, 10);
          const time = h.timestamp.slice(11, 16);
          // Format "09 mai" pour l'affichage compact.
          const [, mm, dd] = date.split("-");
          const moisFr = ["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"];
          const dateFr = `${dd} ${moisFr[parseInt(mm,10) - 1] ?? mm}`;
          return (
            <li
              key={h.session_id + h.timestamp}
              className="flex items-start gap-4 py-3"
              style={{ borderBottom: "1px solid var(--color-rule)" }}
            >
              <div
                className="font-mono text-[11px] leading-tight flex-shrink-0"
                style={{ color: "var(--color-ink-faint)", width: 56 }}
              >
                <div>{dateFr}</div>
                <div>{time}</div>
              </div>
              <div
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  background: "var(--color-rule)",
                  flexShrink: 0,
                }}
              />
              <div className="flex-1 font-display text-[17px] leading-snug break-words">
                {h.phrase_finale}
              </div>
              <button
                onClick={() => speakFr(h.phrase_finale)}
                className="btn-ghost btn-sm flex-shrink-0"
                title="Lire à voix haute"
              >
                <IconSpeaker size={14} />
                <span>Lire</span>
              </button>
            </li>
          );
        })}
    </ol>
  );
}

/* ============================================================ */
/*  Tweaks panel (dev only)                                      */
/* ============================================================ */
function TweaksPanel({ tweaks, setTweaks }: { tweaks: Tweaks; setTweaks: (t: Tweaks) => void }) {
  return (
    <details className="tweaks-panel">
      <summary>Tweaks</summary>
      <div className="mt-2">
        <div className="tweaks-row">
          <label>Densité</label>
          <div className="tweaks-toggle">
            {(["confortable", "compact"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setTweaks({ ...tweaks, density: v })}
                data-active={tweaks.density === v}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="tweaks-row">
          <label>Accent</label>
          <div className="tweaks-toggle">
            {(["sage", "clay"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setTweaks({ ...tweaks, accent: v })}
                data-active={tweaks.accent === v}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="tweaks-row">
          <label>Lecture auto</label>
          <div className="tweaks-toggle">
            {([
              ["off", false],
              ["on", true],
            ] as const).map(([label, val]) => (
              <button
                key={label}
                onClick={() => setTweaks({ ...tweaks, speakAuto: val })}
                data-active={tweaks.speakAuto === val}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

/* ============================================================ */
/*  Web Speech API                                               */
/* ============================================================ */
function speakFr(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    alert("Lecture vocale non supportée par ce navigateur.");
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  const fr = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("fr"));
  if (fr) u.voice = fr;
  window.speechSynthesis.speak(u);
}
