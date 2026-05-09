import { useEffect, useState } from "react";
import { IconCheck } from "./Icon";
import type { ProcessResult } from "../types";

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

  useEffect(() => {
    setSelected(result.propositions[0] ?? "");
    setCustom("");
    setShowDetails(false);
    setValidated(false);
    setError(null);
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
