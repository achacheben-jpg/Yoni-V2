import { useEffect, useRef, useState } from "react";
import { IconCamera, IconCheck, IconRefresh } from "./Icon";

type Cell = {
  id: string;
  label: string;
  type: string;
  bbox_norm: [number, number, number, number];
  corners: [number, number][];
  center: [number, number];
};

type CalibrationData = {
  calibrated: boolean;
  image_filename?: string;
  image_size?: { w: number; h: number };
  nb_cases?: number;
  cells?: Cell[];
};

type CornerLabel = "haut-gauche" | "haut-droit" | "bas-droit" | "bas-gauche";
const CORNER_ORDER: CornerLabel[] = ["haut-gauche", "haut-droit", "bas-droit", "bas-gauche"];

export function Calibration({
  data,
  onChanged,
}: {
  data: CalibrationData | null;
  onChanged: () => void;
}) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [corners, setCorners] = useState<[number, number][]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [renderedSize, setRenderedSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!pendingFile) {
      setPendingUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  useEffect(() => {
    setCorners([]);
    setError(null);
  }, [pendingUrl]);

  const isCalibrated = !!data?.calibrated;

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (corners.length >= 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCorners((prev) => [...prev, [x, y]]);
  };

  const handleImageLoad = () => {
    const el = imgRef.current;
    if (!el) return;
    setRenderedSize({ w: el.clientWidth, h: el.clientHeight });
  };

  const submit = async () => {
    if (!pendingFile || corners.length !== 4 || !renderedSize) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("image", pendingFile);
      fd.append("corners", JSON.stringify(corners));
      fd.append("image_size", JSON.stringify(renderedSize));
      const r = await fetch("/api/calibration", { method: "POST", body: fd });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`POST /api/calibration → ${r.status} ${t}`);
      }
      setPendingFile(null);
      setCorners([]);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const recalibrate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await fetch("/api/calibration", { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Mode 1 : photo locale en cours de calibration (pas encore validée).
  if (pendingUrl) {
    return (
      <div className="space-y-4">
        <Stepper currentStep={corners.length} />

        <div className="relative inline-block max-w-full">
          <img
            ref={imgRef}
            src={pendingUrl}
            onLoad={handleImageLoad}
            onClick={handleImageClick}
            alt="calibration"
            className="max-w-full max-h-[60vh] cursor-crosshair select-none"
            style={{
              borderRadius: "var(--radius-card)",
              border: "1px solid var(--color-rule)",
            }}
            draggable={false}
          />
          {renderedSize && (
            <svg
              className="absolute inset-0 pointer-events-none"
              width={renderedSize.w}
              height={renderedSize.h}
            >
              {corners.length === 4 && (
                <polygon
                  points={corners.map((c) => c.join(",")).join(" ")}
                  fill="rgba(106,138,110,0.18)"
                  stroke="var(--color-sage)"
                  strokeWidth={2}
                />
              )}
              {corners.map((c, i) => (
                <g key={i}>
                  <circle
                    cx={c[0]}
                    cy={c[1]}
                    r={10}
                    fill="#fff"
                    stroke="var(--color-clay)"
                    strokeWidth={2}
                  />
                  <text
                    x={c[0]}
                    y={c[1] + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontFamily="var(--font-mono)"
                    fill="var(--color-clay)"
                    fontWeight="500"
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>

        {error && <div className="banner-error">{error}</div>}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={submit}
            disabled={corners.length !== 4 || submitting}
            className="btn-primary"
          >
            <IconCheck size={16} />
            <span>{submitting ? "Calcul…" : "Valider"}</span>
          </button>
          <button
            onClick={() => setCorners([])}
            disabled={submitting || corners.length === 0}
            className="btn-ghost"
          >
            Effacer les points
          </button>
          <button
            onClick={() => setPendingFile(null)}
            disabled={submitting}
            className="btn-ghost"
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  // Mode 2 : déjà calibré → on affiche l'image stockée et l'overlay des bboxes.
  if (isCalibrated && data?.image_size && data.cells) {
    return (
      <CalibratedView
        data={data}
        onRecalibrate={recalibrate}
        submitting={submitting}
        error={error}
      />
    );
  }

  // Mode 0 : pas encore calibré, pas de photo en cours → upload.
  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: "var(--color-ink-soft)" }}>
        Une photo zénithale du tableau seul. Tu cliqueras ensuite sur les 4 coins dans l'ordre :
        haut-gauche, haut-droit, bas-droit, bas-gauche.
      </p>
      <label className="block cursor-pointer">
        <div
          className="text-center"
          style={{
            border: "2px dashed var(--color-rule)",
            borderRadius: "var(--radius-card)",
            background: "var(--color-canvas)",
            padding: "32px",
            transition: "background 0.15s ease, border-color 0.15s ease",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              background: "var(--color-surface)",
              color: "var(--color-ink-soft)",
              marginBottom: 10,
            }}
          >
            <IconCamera size={24} />
          </div>
          <div className="font-display text-base font-semibold" style={{ color: "var(--color-ink)" }}>
            Choisir une photo du tableau
          </div>
          <div className="text-[13px] mt-1" style={{ color: "var(--color-ink-soft)" }}>
            JPEG ou PNG · vue zénithale, tableau bien à plat
          </div>
        </div>
        <input
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <div className="banner-error">{error}</div>}
    </div>
  );
}

/* ============================================================ */
/*  Stepper : 4 étapes haut-gauche → bas-gauche                  */
/* ============================================================ */
function Stepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="space-y-2">
      <div className="stepper">
        {CORNER_ORDER.map((label, i) => {
          const state = i < currentStep ? "done" : i === currentStep ? "current" : "future";
          return (
            <span key={label} className="contents">
              <span className="stepper-step" data-state={state}>
                <span style={{ minWidth: 12 }}>{i + 1}</span>
                <span>{label}</span>
              </span>
              {i < CORNER_ORDER.length - 1 && <span className="stepper-sep">›</span>}
            </span>
          );
        })}
      </div>
      <div
        className="font-mono text-[11px]"
        style={{ color: "var(--color-ink-faint)" }}
      >
        {currentStep < 4
          ? `${currentStep}/4 coins placés — clic sur l'image pour ajouter le suivant`
          : "4/4 coins placés — vérifie l'ordre puis valide"}
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Vue calibrée                                                 */
/* ============================================================ */
function CalibratedView({
  data,
  onRecalibrate,
  submitting,
  error,
}: {
  data: CalibrationData;
  onRecalibrate: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [rendered, setRendered] = useState<{ w: number; h: number } | null>(null);

  const handleLoad = () => {
    const el = imgRef.current;
    if (!el) return;
    setRendered({ w: el.clientWidth, h: el.clientHeight });
  };

  const realW = data.image_size!.w;
  const realH = data.image_size!.h;

  return (
    <div className="space-y-3">
      <div className="text-sm" style={{ color: "var(--color-ink-soft)" }}>
        {data.cells!.length} cases sur le tableau. Vérifie que chaque rectangle correspond à la
        bonne case ; sinon, signale-le pour ajuster <span className="font-mono text-[12px]">tableau.json</span>.
      </div>
      <div className="relative inline-block max-w-full">
        <img
          ref={imgRef}
          src={"/api/calibration/image?t=" + Date.now()}
          onLoad={handleLoad}
          alt="tableau calibré"
          className="max-w-full max-h-[60vh]"
          style={{
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--color-rule)",
          }}
          draggable={false}
        />
        {rendered && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width={rendered.w}
            height={rendered.h}
          >
            {data.cells!.map((cell) => {
              const sx = rendered.w / realW;
              const sy = rendered.h / realH;
              const pts = cell.corners.map(([x, y]) => `${x * sx},${y * sy}`).join(" ");
              const [cx, cy] = cell.center;
              return (
                <g key={cell.id}>
                  <polygon
                    points={pts}
                    fill="rgba(106,138,110,0.10)"
                    stroke="rgba(106,138,110,0.55)"
                    strokeWidth={1}
                  />
                  <text
                    x={cx * sx}
                    y={cy * sy + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontFamily="var(--font-mono)"
                    fill="var(--color-ink)"
                    fontWeight="500"
                    style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}
                  >
                    {cell.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {error && <div className="banner-error">{error}</div>}
      <button
        onClick={onRecalibrate}
        disabled={submitting}
        className="btn-ghost"
      >
        <IconRefresh size={14} />
        <span>Changer de photo / recalibrer</span>
      </button>
    </div>
  );
}
