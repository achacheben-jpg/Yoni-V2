import { useEffect, useState } from "react";
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

  return (
    <div className="space-y-4">
      {result.claude_error && (
        <div className="rounded bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-800">
          Reconstruction Claude indisponible : {result.claude_error}
        </div>
      )}

      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Phrase principale</div>
        <div className="text-2xl md:text-3xl font-semibold leading-tight break-words">
          {finalPhrase || <span className="text-slate-400">…</span>}
        </div>
      </div>

      {result.propositions.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">
            Autres propositions (clic pour basculer)
          </div>
          <div className="flex flex-wrap gap-2">
            {result.propositions.map((p, i) => (
              <button
                key={i}
                onClick={() => {
                  setSelected(p);
                  setCustom("");
                }}
                className={
                  "px-3 py-2 rounded text-sm border min-h-[44px] " +
                  (selected === p && !custom.trim()
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50")
                }
              >
                <span className="text-slate-400 mr-1">{i + 1}.</span> {p}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-slate-500 uppercase tracking-wide block mb-1">
          Phrase correcte (à compléter si aucune n'est juste)
        </label>
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="…"
          className="w-full rounded border border-slate-300 px-3 py-2 text-base focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-pink-100 text-pink-800 px-2 py-0.5 text-xs">
          Pastille : {couleurFr}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-xs">
          {result.pointages.length} pointage{result.pointages.length > 1 ? "s" : ""}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-xs">
          session {result.session_id}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={validate}
          disabled={submitting || validated || !finalPhrase}
          className="px-4 py-2 rounded bg-green-600 text-white font-medium disabled:bg-slate-300 disabled:text-slate-500 min-h-[44px]"
        >
          {validated ? "✓ Validé" : submitting ? "Enregistrement…" : "✓ Valider et apprendre"}
        </button>
        <button
          onClick={() => setShowDetails((v) => !v)}
          className="px-4 py-2 rounded bg-white border border-slate-300 text-sm min-h-[44px]"
        >
          {showDetails ? "Masquer les détails" : "Détails techniques"}
        </button>
      </div>

      {error && <div className="text-sm text-red-700">{error}</div>}

      {showDetails && (
        <div className="rounded border border-slate-200 bg-white p-3 space-y-3 text-sm">
          <div>
            <div className="text-xs text-slate-500 uppercase mb-1">Séquence cases</div>
            <div className="font-mono text-xs break-all">
              {result.label_sequence.map((l, i) => (
                <span key={i} className="inline-block mr-1 mb-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded">
                  {l ?? "?"}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase mb-1">Transcription audio (Whisper)</div>
            <div className="font-mono text-xs whitespace-pre-wrap">
              {result.audio_transcript.text || <span className="text-slate-400">(silence)</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase mb-1">Segments audio</div>
            <ul className="text-xs list-disc list-inside text-slate-600">
              {result.audio_transcript.segments.length === 0 && <li className="list-none text-slate-400">aucun</li>}
              {result.audio_transcript.segments.map((s, i) => (
                <li key={i}>
                  [{s.start.toFixed(2)}s → {s.end.toFixed(2)}s] {s.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase mb-1">Pointages bruts</div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left py-1">t</th>
                  <th className="text-left py-1">px</th>
                  <th className="text-left py-1">case</th>
                  <th className="text-left py-1">durée</th>
                </tr>
              </thead>
              <tbody>
                {result.pointages.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1">{p.t_start.toFixed(2)}–{p.t_end.toFixed(2)}s</td>
                    <td className="py-1">({p.x_pixel.toFixed(0)}, {p.y_pixel.toFixed(0)})</td>
                    <td className="py-1">{p.label ?? "?"}</td>
                    <td className="py-1">{p.duration.toFixed(2)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
