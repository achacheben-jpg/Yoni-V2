import { useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconDownload,
  IconPaperclip,
  IconPlay,
  IconRecord,
  IconRefresh,
  IconSquare,
} from "./Icon";
import type { ProcessResult } from "../types";

/**
 * Trois modes :
 *   - "auto"    : "Démarrer la session" → enregistre + envoie direct au pipeline (workflow Yoni en live, une seule prise)
 *   - "preview" : "Enregistrer une session" → enregistre puis ajoute à la liste de prises (mode rafale)
 *   - upload de fichier → ajoute aussi à la liste de prises
 *
 * En mode preview/upload, on accumule les prises et on choisit pour chacune : envoyer / télécharger / supprimer.
 */
type RecMode = "auto" | "preview";

type Take = {
  id: string;
  blob: Blob;
  url: string;
  filename: string;
  takenAt: string; // HH:MM:SS pour l'affichage
  duration: number | null; // secondes, calculé via <video onLoadedMetadata>
  status: "idle" | "uploading" | "sent" | "error";
  errorMsg?: string;
  source: "record" | "upload";
};

let _takeSeq = 0;
const newId = () => `take-${Date.now()}-${++_takeSeq}`;

export function Session({
  calibrated,
  onResult,
}: {
  calibrated: boolean;
  onResult: (r: ProcessResult) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recMode, setRecMode] = useState<RecMode>("auto");
  const liveVideoRef = useRef<HTMLVideoElement>(null);

  // Liste des prises (rafale).
  const [takes, setTakes] = useState<Take[]>([]);

  // Pour le mode "auto" uniquement : un état de loading pendant l'envoi direct.
  const [autoUploading, setAutoUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (liveVideoRef.current && stream) {
      liveVideoRef.current.srcObject = stream;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Cleanup global : flux + URL des prises au démontage.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      takes.forEach((t) => URL.revokeObjectURL(t.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTake = (blob: Blob, source: "record" | "upload", filename?: string) => {
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const id = newId();
    const t: Take = {
      id,
      blob,
      url: URL.createObjectURL(blob),
      filename: filename ?? `prise-${takes.length + 1}.${ext}`,
      takenAt: new Date().toLocaleTimeString("fr-FR", { hour12: false }),
      duration: null,
      status: "idle",
      source,
    };
    setTakes((prev) => [...prev, t]);
  };

  const updateTake = (id: string, patch: Partial<Take>) => {
    setTakes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const removeTake = (id: string) => {
    setTakes((prev) => {
      const t = prev.find((x) => x.id === id);
      if (t) URL.revokeObjectURL(t.url);
      return prev.filter((x) => x.id !== id);
    });
  };

  const clearAllTakes = () => {
    takes.forEach((t) => URL.revokeObjectURL(t.url));
    setTakes([]);
    setError(null);
  };

  const startRecording = async (mode: RecMode) => {
    setError(null);
    setRecMode(mode);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(s);
      const mimeCandidates = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: mr.mimeType || "video/webm" });
        s.getTracks().forEach((t) => t.stop());
        setStream(null);
        setRecorder(null);
        setRecording(false);

        if (mode === "auto") {
          // Workflow live : envoi direct au pipeline, pas de rafale.
          const filename = blob.type.includes("mp4") ? "session.mp4" : "session.webm";
          await sendBlobDirectly(blob, filename);
        } else {
          // Workflow rafale : on ajoute à la liste de prises.
          addTake(blob, "record");
        }
      };
      mr.start();
      setRecorder(mr);
      setRecording(true);
    } catch (e) {
      setError(`Caméra/micro inaccessibles : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stopRecording = () => recorder?.stop();

  const handleFile = (file: File) => {
    addTake(file, "upload", file.name);
    setError(null);
  };

  const sendBlobDirectly = async (blob: Blob, filename: string) => {
    setAutoUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("video", blob, filename);
      const r = await fetch("/api/process", { method: "POST", body: fd });
      const text = await r.text();
      if (!r.ok) {
        let detail = text;
        try {
          detail = JSON.parse(text).detail || text;
        } catch {
          /* texte brut */
        }
        throw new Error(detail);
      }
      onResult(JSON.parse(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoUploading(false);
    }
  };

  const sendTake = async (id: string) => {
    const t = takes.find((x) => x.id === id);
    if (!t) return;
    updateTake(id, { status: "uploading", errorMsg: undefined });
    try {
      const fd = new FormData();
      fd.append("video", t.blob, t.filename);
      const r = await fetch("/api/process", { method: "POST", body: fd });
      const text = await r.text();
      if (!r.ok) {
        let detail = text;
        try {
          detail = JSON.parse(text).detail || text;
        } catch {
          /* texte brut */
        }
        throw new Error(detail);
      }
      onResult(JSON.parse(text));
      updateTake(id, { status: "sent" });
    } catch (e) {
      updateTake(id, {
        status: "error",
        errorMsg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const downloadTake = (id: string) => {
    const t = takes.find((x) => x.id === id);
    if (!t) return;
    const a = document.createElement("a");
    a.href = t.url;
    a.download = t.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /* ------------------------------ */
  /*  Mode live recording           */
  /* ------------------------------ */
  if (recording) {
    return (
      <div className="space-y-4">
        <div className="quote-warm">
          {recMode === "auto"
            ? "Enregistrement en cours — la vidéo sera envoyée au pipeline dès l'arrêt. Lis chaque case à voix haute pendant que Yoni pointe à la pastille fluo."
            : `Prise n°${takes.length + 1} en cours — elle s'ajoutera à la liste à l'arrêt. Tu pourras choisir laquelle envoyer.`}
        </div>
        <div className="flex items-center gap-2" style={{ color: "var(--color-clay)" }}>
          <span
            className="pill-dot"
            style={{
              background: "var(--color-clay)",
              animation: "rec-blink 1.2s ease-in-out infinite",
            }}
          />
          <span className="font-mono text-[11px] uppercase tracking-wide">REC</span>
        </div>
        <div
          className="overflow-hidden"
          style={{
            background: "var(--color-ink)",
            borderRadius: "var(--radius-card)",
            maxHeight: 320,
          }}
        >
          <video
            ref={liveVideoRef}
            muted
            playsInline
            className="w-full max-h-80 object-contain"
          />
        </div>
        <button onClick={stopRecording} className="btn-danger">
          <IconSquare size={12} />
          <span>Terminer</span>
        </button>
        <style>{`@keyframes rec-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </div>
    );
  }

  /* ------------------------------ */
  /*  Mode initial / rafale         */
  /* ------------------------------ */
  return (
    <div className="space-y-4">
      <div className="quote-warm">
        Mode lecture vocale : la personne près de Yoni lit chaque case à voix haute pendant
        qu'il pointe à la pastille fluo, puis dit la phrase finale.
      </div>

      {/* Boutons d'action */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => startRecording("auto")}
          disabled={!calibrated || autoUploading}
          className="btn-primary"
          title={!calibrated ? "Calibration requise pour le traitement automatique" : undefined}
        >
          <IconPlay size={14} />
          <span>Démarrer la session</span>
        </button>
        <button
          onClick={() => startRecording("preview")}
          disabled={autoUploading}
          className="btn-ghost"
        >
          <IconRecord size={10} style={{ color: "var(--color-clay)" }} />
          <span>{takes.length === 0 ? "Enregistrer une session" : "+ Nouvelle prise"}</span>
        </button>
        <label className="btn-ghost cursor-pointer">
          <IconPaperclip size={14} />
          <span>Téléverser un .mov / .mp4</span>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {takes.length === 0 && (
        <div className="text-[12px]" style={{ color: "var(--color-ink-faint)" }}>
          <span className="font-mono">▸ Démarrer la session</span> envoie la vidéo
          directement au pipeline.
          <br />
          <span className="font-mono">● Enregistrer une session</span> ouvre un mode rafale —
          tu peux accumuler plusieurs prises avant de choisir laquelle traiter.
        </div>
      )}

      {!calibrated && (
        <div className="banner-amber">
          Calibration requise pour le traitement automatique — tu peux toutefois enregistrer
          ou téléverser des prises et les garder en local.
        </div>
      )}

      {autoUploading && (
        <div className="space-y-2">
          <div className="banner-amber">
            Pipeline en cours sur ta session live (extraction frames, détection pastille,
            transcription audio, appel Claude). 30 à 60 secondes.
          </div>
          <div className="progress-indeterminate" aria-label="Traitement en cours" />
        </div>
      )}

      {error && <div className="banner-error">Erreur : {error}</div>}

      {/* Liste de prises (rafale) */}
      {takes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div
              className="font-mono text-[11px] uppercase tracking-wide"
              style={{ color: "var(--color-ink-faint)" }}
            >
              prises en attente · {takes.length}
            </div>
            <button
              onClick={clearAllTakes}
              className="btn-ghost btn-sm"
              disabled={takes.some((t) => t.status === "uploading")}
            >
              <IconRefresh size={13} />
              <span>Vider</span>
            </button>
          </div>

          {takes.map((take, idx) => (
            <TakeCard
              key={take.id}
              take={take}
              index={idx}
              calibrated={calibrated}
              onSend={() => sendTake(take.id)}
              onDownload={() => downloadTake(take.id)}
              onRemove={() => removeTake(take.id)}
              onDuration={(d) => updateTake(take.id, { duration: d })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
/*  TakeCard : une prise en mode rafale                          */
/* ============================================================ */
function TakeCard({
  take,
  index,
  calibrated,
  onSend,
  onDownload,
  onRemove,
  onDuration,
}: {
  take: Take;
  index: number;
  calibrated: boolean;
  onSend: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onDuration: (d: number) => void;
}) {
  const sizeMo = (take.blob.size / 1024 / 1024).toFixed(1);
  const dur = take.duration != null ? `${take.duration.toFixed(1)} s` : null;

  const statusBadge = () => {
    if (take.status === "sent") {
      return (
        <span className="pill" style={{ background: "var(--color-sage-soft)", color: "var(--color-ink)" }}>
          <span className="pill-dot" style={{ background: "var(--color-sage)" }} />
          envoyée
        </span>
      );
    }
    if (take.status === "uploading") {
      return (
        <span className="pill" style={{ background: "var(--color-amber-soft)", color: "var(--color-ink)" }}>
          <span className="pill-dot" style={{ background: "#c79a3b" }} />
          envoi…
        </span>
      );
    }
    if (take.status === "error") {
      return (
        <span className="pill" style={{ background: "var(--color-clay-soft)", color: "var(--color-ink)" }}>
          <span className="pill-dot" style={{ background: "var(--color-clay)" }} />
          erreur
        </span>
      );
    }
    return null;
  };

  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-rule)",
        borderRadius: "var(--radius-card)",
        padding: "12px 14px",
      }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-mono text-[11px] flex items-center justify-center"
            style={{
              background: "var(--color-canvas)",
              color: "var(--color-ink-soft)",
              minWidth: 24,
              height: 24,
              borderRadius: "50%",
              border: "1px solid var(--color-rule)",
            }}
          >
            {index + 1}
          </span>
          <span
            className="pill"
            style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}
          >
            {take.takenAt}
          </span>
          <span
            className="pill"
            style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}
          >
            {sizeMo} Mo
          </span>
          {dur && (
            <span
              className="pill"
              style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}
            >
              {dur}
            </span>
          )}
          {take.source === "upload" && (
            <span
              className="pill"
              style={{ background: "var(--color-canvas)", color: "var(--color-ink-faint)" }}
              title={take.filename}
            >
              fichier
            </span>
          )}
          {statusBadge()}
        </div>
      </div>

      <div
        className="overflow-hidden"
        style={{
          background: "var(--color-ink)",
          borderRadius: 8,
          maxHeight: 220,
        }}
      >
        <video
          src={take.url}
          controls
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.duration && Number.isFinite(v.duration)) onDuration(v.duration);
          }}
          className="w-full max-h-[220px] object-contain"
        />
      </div>

      {take.errorMsg && (
        <div className="banner-error" style={{ fontSize: 12 }}>
          {take.errorMsg}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSend}
          disabled={!calibrated || take.status === "uploading"}
          className="btn-primary btn-sm"
          title={!calibrated ? "Calibration requise" : undefined}
        >
          <IconCheck size={14} />
          <span>
            {take.status === "uploading"
              ? "Envoi…"
              : take.status === "sent"
                ? "Renvoyer"
                : "Envoyer pour traitement"}
          </span>
        </button>
        <button
          onClick={onDownload}
          disabled={take.status === "uploading"}
          className="btn-ghost btn-sm"
        >
          <IconDownload size={14} />
          <span>Télécharger</span>
        </button>
        <button
          onClick={onRemove}
          disabled={take.status === "uploading"}
          className="btn-ghost btn-sm"
        >
          <span>Supprimer</span>
        </button>
      </div>
    </div>
  );
}
