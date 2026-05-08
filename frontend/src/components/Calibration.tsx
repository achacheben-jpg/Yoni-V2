import { useEffect, useRef, useState } from "react";

type Cell = {
  id: string;
  label: string;
  type: string;
  row: number;
  col: number;
  corners: [number, number][];
  center: [number, number];
};

type CalibrationData = {
  calibrated: boolean;
  image_filename?: string;
  image_size?: { w: number; h: number };
  rows?: number;
  cols?: number;
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

  // URL pour preview locale après upload.
  useEffect(() => {
    if (!pendingFile) {
      setPendingUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  // Reset les coins quand on recharge une nouvelle image.
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

  // Mode 1 : image locale en cours de calibration (pas encore validée).
  if (pendingUrl) {
    const next = CORNER_ORDER[corners.length];
    return (
      <div className="space-y-3">
        <div className="text-sm text-slate-600">
          {next ? (
            <>
              Clique sur le coin <strong>{next}</strong> du tableau ({corners.length}/4 placés).
            </>
          ) : (
            <>4 coins placés. Vérifie l'ordre puis valide.</>
          )}
        </div>
        <div className="relative inline-block max-w-full">
          <img
            ref={imgRef}
            src={pendingUrl}
            onLoad={handleImageLoad}
            onClick={handleImageClick}
            alt="calibration"
            className="max-w-full max-h-[60vh] cursor-crosshair select-none rounded border border-slate-300"
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
                  fill="rgba(34,197,94,0.15)"
                  stroke="rgb(34,197,94)"
                  strokeWidth={2}
                />
              )}
              {corners.map((c, i) => (
                <g key={i}>
                  <circle cx={c[0]} cy={c[1]} r={8} fill="white" stroke="rgb(220,38,38)" strokeWidth={2} />
                  <text
                    x={c[0]}
                    y={c[1] + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fill="rgb(220,38,38)"
                    fontWeight="bold"
                  >
                    {i + 1}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={corners.length !== 4 || submitting}
            className="px-4 py-2 rounded bg-green-600 text-white text-sm disabled:bg-slate-300 disabled:text-slate-500"
          >
            {submitting ? "Calcul…" : "✓ Valider"}
          </button>
          <button
            onClick={() => setCorners([])}
            disabled={submitting || corners.length === 0}
            className="px-3 py-2 rounded bg-white border border-slate-300 text-sm"
          >
            Effacer les points
          </button>
          <button
            onClick={() => setPendingFile(null)}
            disabled={submitting}
            className="px-3 py-2 rounded bg-white border border-slate-300 text-sm"
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
      <CalibratedView data={data} onRecalibrate={recalibrate} submitting={submitting} error={error} />
    );
  }

  // Mode 0 : pas encore calibré, pas d'image en cours → upload.
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Upload une photo zénithale du tableau seul. Tu cliqueras ensuite sur les 4 coins dans l'ordre :
        haut-gauche, haut-droit, bas-droit, bas-gauche.
      </p>
      <input
        type="file"
        accept="image/jpeg,image/png"
        onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
        className="block text-sm"
      />
      {error && <div className="text-sm text-red-700">{error}</div>}
    </div>
  );
}

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
      <div className="text-sm text-slate-600">
        Tableau {data.rows}×{data.cols} — {data.cells!.length} cases. Vérifie que les rectangles
        correspondent aux cases du tableau ; si ce n'est pas le cas, recalibre.
      </div>
      <div className="relative inline-block max-w-full">
        <img
          ref={imgRef}
          src={"/api/calibration/image?t=" + Date.now()}
          onLoad={handleLoad}
          alt="tableau calibré"
          className="max-w-full max-h-[60vh] rounded border border-slate-300"
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
                    fill="rgba(59,130,246,0.10)"
                    stroke="rgba(59,130,246,0.7)"
                    strokeWidth={1}
                  />
                  <text
                    x={cx * sx}
                    y={cy * sy + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fill="rgb(30,64,175)"
                    fontWeight="bold"
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
      {error && <div className="text-sm text-red-700">{error}</div>}
      <button
        onClick={onRecalibrate}
        disabled={submitting}
        className="px-3 py-2 rounded bg-white border border-slate-300 text-sm"
      >
        Recalibrer
      </button>
    </div>
  );
}
