import { useEffect, useRef, useState } from "react";
import { IconCheck } from "./Icon";
import type { ProcessResult } from "../types";

type CalibrationData = {
  calibrated: boolean;
  image_size?: { w: number; h: number };
  cells?: {
    id: string;
    label: string;
    corners: [number, number][];
    center: [number, number];
  }[];
};

export function Result({
  result,
  onValidated,
}: {
  result: ProcessResult;
  onValidated: (phrase: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState<string>("");
  const [showDetails, setShowDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);

  useEffect(() => {
    setSelected(result.propositions[0] ?? "");
    setCustom("");
    setShowDetails(false);
    setValidated(false);
    setError(null);
  }, [result]);

  // Fetch la calibration pour superposer la détection sur la photo du tableau.
  useEffect(() => {
    fetch("/api/calibration")
      .then((r) => r.json())
      .then(setCalibration)
      .catch(() => {});
  }, [result]);

  const finalPhrase = (custom.trim() || selected || "").trim();

  const validate = async () => {
    if (!finalPhrase) {
      setError("Aucune phrase à valider — sélectionne une proposition ou complète manuellement.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: result.session_id,
          phrase_finale: finalPhrase,
          phrase_proposee_n1: result.propositions[0] ?? null,
          phrase_humaine_corrigee: custom.trim() || null,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t);
      }
      setValidated(true);
      onValidated(finalPhrase);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const couleurFr = result.couleur_pastille_detectee === "fuchsia" ? "fuchsia" : "vert fluo";
  const couleurDot = result.couleur_pastille_detectee === "fuchsia" ? "#d1396b" : "#7cb342";

  return (
    <div className="space-y-5">
      {result.claude_error && (
        <div className="banner-amber">
          Reconstruction Claude indisponible : {result.claude_error}
        </div>
      )}

      {/* Vue détection : photo calibration + cases pointées en surimpression */}
      {calibration?.calibrated && calibration.cells && calibration.image_size && (
        <DetectionView result={result} calibration={calibration} />
      )}

      {/* Phrase principale */}
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-rule)",
          borderRadius: "var(--radius-card)",
          padding: "24px 28px",
        }}
      >
        <div
          className="font-mono text-[11px] uppercase tracking-wide mb-2"
          style={{ color: "var(--color-ink-faint)" }}
        >
          phrase principale
        </div>
        <div
          className="font-display font-semibold leading-tight break-words"
          style={{ fontSize: 32, lineHeight: 1.15, textWrap: "pretty" as never }}
        >
          {finalPhrase || (
            <span style={{ color: "var(--color-ink-faint)" }}>…</span>
          )}
        </div>
      </div>

      {/* Autres propositions */}
      {result.propositions.length > 0 && (
        <div>
          <div
            className="font-mono text-[11px] uppercase tracking-wide mb-2"
            style={{ color: "var(--color-ink-faint)" }}
          >
            autres propositions (clic pour basculer)
          </div>
          <div className="flex flex-wrap gap-2">
            {result.propositions.map((p, i) => {
              const isSelected = selected === p && !custom.trim();
              return (
                <button
                  key={i}
                  onClick={() => {
                    setSelected(p);
                    setCustom("");
                  }}
                  className="chip-prop"
                  data-selected={isSelected}
                >
                  <span className="chip-prop-num">{i + 1}.</span>
                  <span>{p}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Champ correction */}
      <div>
        <label
          className="font-mono text-[11px] uppercase tracking-wide block mb-2"
          style={{ color: "var(--color-ink-faint)" }}
        >
          phrase correcte (à compléter si aucune n'est juste)
        </label>
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="…"
          className="input-atelier"
        />
      </div>

      {/* Méta-pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill" style={{ background: "var(--color-canvas)", color: "var(--color-ink)" }}>
          <span className="pill-dot" style={{ background: couleurDot }} />
          pastille : {couleurFr}
        </span>
        <span className="pill" style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}>
          {result.pointages.length} pointage{result.pointages.length > 1 ? "s" : ""}
        </span>
        <span className="pill" style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}>
          session {result.session_id}
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={validate}
          disabled={submitting || validated || !finalPhrase}
          className="btn-primary"
        >
          <IconCheck size={16} />
          <span>
            {validated ? "Validé" : submitting ? "Enregistrement…" : "Valider et apprendre"}
          </span>
        </button>
        <button onClick={() => setShowDetails((v) => !v)} className="btn-ghost">
          {showDetails ? "Masquer les détails" : "Détails techniques"}
        </button>
      </div>

      {error && <div className="banner-error">{error}</div>}

      {showDetails && (
        <div
          className="space-y-4"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-rule)",
            borderRadius: "var(--radius-card)",
            padding: "16px 18px",
          }}
        >
          <DetailBlock label="Séquence cases">
            <div className="flex flex-wrap gap-1">
              {result.label_sequence.map((l, i) => (
                <span
                  key={i}
                  className="font-mono text-[12px] px-2 py-1"
                  style={{
                    background: "var(--color-sage-soft)",
                    color: "var(--color-ink)",
                    borderRadius: 4,
                  }}
                >
                  {l ?? "?"}
                </span>
              ))}
            </div>
          </DetailBlock>

          <DetailBlock label="Transcription audio (Whisper)">
            <div
              className="font-mono text-[12px] whitespace-pre-wrap"
              style={{ color: result.audio_transcript.text ? "var(--color-ink)" : "var(--color-ink-faint)" }}
            >
              {result.audio_transcript.text || "(silence)"}
            </div>
          </DetailBlock>

          <DetailBlock label="Segments audio">
            {result.audio_transcript.segments.length === 0 ? (
              <div className="text-[12px]" style={{ color: "var(--color-ink-faint)" }}>aucun</div>
            ) : (
              <ul className="text-[12px] font-mono space-y-1" style={{ color: "var(--color-ink-soft)" }}>
                {result.audio_transcript.segments.map((s, i) => (
                  <li key={i}>
                    [{s.start.toFixed(2)}s → {s.end.toFixed(2)}s] {s.text}
                  </li>
                ))}
              </ul>
            )}
          </DetailBlock>

          <DetailBlock label="Pointages bruts">
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              <table className="zebra-table">
                <thead>
                  <tr>
                    <th>t</th>
                    <th>px</th>
                    <th>case</th>
                    <th>durée</th>
                  </tr>
                </thead>
                <tbody>
                  {result.pointages.map((p, i) => (
                    <tr key={i}>
                      <td>{p.t_start.toFixed(2)}–{p.t_end.toFixed(2)}s</td>
                      <td>({p.x_pixel.toFixed(0)}, {p.y_pixel.toFixed(0)})</td>
                      <td>{p.label ?? "?"}</td>
                      <td>{p.duration.toFixed(2)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailBlock>
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
/*  Vue détection : photo + cases pointées en surimpression      */
/* ============================================================ */
function DetectionView({
  result,
  calibration,
}: {
  result: ProcessResult;
  calibration: CalibrationData;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [rendered, setRendered] = useState<{ w: number; h: number } | null>(null);

  const handleLoad = () => {
    const el = imgRef.current;
    if (!el) return;
    setRendered({ w: el.clientWidth, h: el.clientHeight });
  };

  const realW = calibration.image_size!.w;
  const realH = calibration.image_size!.h;
  const cellById = new Map(calibration.cells!.map((c) => [c.id, c]));

  // Pour les pointages, on prend l'id corrigé en priorité (sinon géométrique).
  const detectedIds = new Set(
    result.pointages
      .map((p) => (p as any).case_id_corrigee || p.case_id_geometrique)
      .filter(Boolean) as string[],
  );

  return (
    <div
      className="space-y-2"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-rule)",
        borderRadius: "var(--radius-card)",
        padding: "16px 18px",
      }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div
          className="font-mono text-[11px] uppercase tracking-wide"
          style={{ color: "var(--color-ink-faint)" }}
        >
          détection sur le tableau · {result.pointages.length} pointage
          {result.pointages.length > 1 ? "s" : ""}
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]" style={{ color: "var(--color-ink-soft)" }}>
          <span className="flex items-center gap-1">
            <span
              className="pill-dot"
              style={{ background: "rgba(106,138,110,0.55)", width: 10, height: 10 }}
            />
            case détectée
          </span>
          <span className="flex items-center gap-1">
            <span className="pill-dot" style={{ background: "var(--color-clay)", width: 10, height: 10 }} />
            point exact
          </span>
        </div>
      </div>

      <div className="relative inline-block max-w-full">
        <img
          ref={imgRef}
          src={"/api/calibration/image?t=" + result.session_id}
          onLoad={handleLoad}
          alt="détection sur le tableau"
          className="max-w-full max-h-[480px]"
          style={{
            borderRadius: 8,
            border: "1px solid var(--color-rule)",
            display: "block",
          }}
          draggable={false}
        />
        {rendered && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width={rendered.w}
            height={rendered.h}
          >
            {/* 1. Toutes les cases en gris très léger pour donner le contexte */}
            {calibration.cells!.map((cell) => {
              const sx = rendered.w / realW;
              const sy = rendered.h / realH;
              const pts = cell.corners.map(([x, y]) => `${x * sx},${y * sy}`).join(" ");
              const isHit = detectedIds.has(cell.id);
              return (
                <polygon
                  key={cell.id}
                  points={pts}
                  fill={isHit ? "rgba(106,138,110,0.35)" : "rgba(106,138,110,0.04)"}
                  stroke={isHit ? "var(--color-sage)" : "rgba(106,138,110,0.25)"}
                  strokeWidth={isHit ? 2 : 1}
                />
              );
            })}

            {/* 2. Label de chaque case détectée */}
            {result.pointages.map((p, i) => {
              const cellId = (p as any).case_id_corrigee || p.case_id_geometrique;
              if (!cellId) return null;
              const cell = cellById.get(cellId);
              if (!cell) return null;
              const sx = rendered.w / realW;
              const sy = rendered.h / realH;
              const [cx, cy] = cell.center;
              return (
                <text
                  key={"lbl-" + i}
                  x={cx * sx}
                  y={cy * sy + 4}
                  textAnchor="middle"
                  fontSize="13"
                  fontFamily="var(--font-display)"
                  fontWeight="600"
                  fill="var(--color-ink)"
                  style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4 }}
                >
                  {cell.label}
                </text>
              );
            })}

            {/* 3. Point exact + numéro d'ordre (1, 2, 3…) en clay */}
            {result.pointages.map((p, i) => {
              const sx = rendered.w / realW;
              const sy = rendered.h / realH;
              const px = p.x_pixel * sx;
              const py = p.y_pixel * sy;
              return (
                <g key={"pt-" + i}>
                  <circle
                    cx={px}
                    cy={py}
                    r={11}
                    fill="white"
                    stroke="var(--color-clay)"
                    strokeWidth={2}
                  />
                  <text
                    x={px}
                    y={py + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontFamily="var(--font-mono)"
                    fontWeight="600"
                    fill="var(--color-clay)"
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Séquence en clair, ordonnée */}
      <div className="flex flex-wrap items-center gap-1 mt-2">
        <span
          className="font-mono text-[11px] uppercase tracking-wide mr-2"
          style={{ color: "var(--color-ink-faint)" }}
        >
          séquence
        </span>
        {result.pointages.map((p, i) => {
          const cellId = (p as any).case_id_corrigee || p.case_id_geometrique;
          const label = cellId ? cellById.get(cellId)?.label ?? p.label ?? "?" : "?";
          return (
            <span key={i} className="flex items-center gap-1">
              <span
                className="font-mono text-[11px]"
                style={{
                  background: cellId ? "var(--color-sage-soft)" : "var(--color-clay-soft)",
                  color: "var(--color-ink)",
                  padding: "3px 8px",
                  borderRadius: 4,
                }}
              >
                <span style={{ color: "var(--color-ink-faint)" }}>{i + 1}.</span> {label}
              </span>
              {i < result.pointages.length - 1 && (
                <span style={{ color: "var(--color-ink-faint)" }}>→</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="font-mono text-[10px] uppercase tracking-wide mb-1"
        style={{ color: "var(--color-ink-faint)" }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
