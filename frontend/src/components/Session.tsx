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
 * Deux modes d'enregistrement :
 *   - "auto"    : "Démarrer la session" → enregistre + envoie direct au pipeline (workflow Yoni en live)
 *   - "preview" : "Enregistrer une session" → enregistre + aperçu avec 3 actions (envoyer/télécharger/recommencer)
 *   - upload de fichier → toujours mode "preview"
 */
type RecMode = "auto" | "preview";

export function Session({
  calibrated,
  onResult,
}: {
  calibrated: boolean;
  onResult: (r: ProcessResult) => void;
}) {
  // Live recording
  const [recording, setRecording] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recMode, setRecMode] = useState<RecMode>("auto");
  const liveVideoRef = useRef<HTMLVideoElement>(null);

  // Aperçu post-capture
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedFilename, setRecordedFilename] = useState<string>("session.webm");

  // Pipeline upload
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (liveVideoRef.current && stream) {
      liveVideoRef.current.srcObject = stream;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    if (!recordedBlob) {
      setRecordedUrl(null);
      return;
    }
    const url = URL.createObjectURL(recordedBlob);
    setRecordedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordedBlob]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async (mode: RecMode) => {
    setError(null);
    setRecordedBlob(null);
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
        const filename = blob.type.includes("mp4") ? "session.mp4" : "session.webm";
        s.getTracks().forEach((t) => t.stop());
        setStream(null);
        setRecorder(null);
        setRecording(false);

        if (mode === "auto") {
          // Workflow live : envoi direct au pipeline.
          await sendBlobToPipeline(blob, filename);
        } else {
          // Workflow archive : on garde la vidéo pour l'aperçu.
          setRecordedBlob(blob);
          setRecordedFilename(filename);
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
    setRecordedBlob(file);
    setRecordedFilename(file.name);
    setError(null);
  };

  const sendBlobToPipeline = async (blob: Blob, filename: string) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("video", blob, filename);
      const r = await fetch("/api/process", { method: "POST", body: fd });
      const text = await r.text();
      if (!r.ok) {
        try {
          const j = JSON.parse(text);
          throw new Error(j.detail || text);
        } catch {
          throw new Error(text);
        }
      }
      onResult(JSON.parse(text));
      setRecordedBlob(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const sendForProcessing = () => {
    if (!recordedBlob) return;
    void sendBlobToPipeline(recordedBlob, recordedFilename);
  };

  const downloadRecording = () => {
    if (!recordedUrl) return;
    const a = document.createElement("a");
    a.href = recordedUrl;
    a.download = recordedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const restart = () => {
    setRecordedBlob(null);
    setError(null);
  };

  /* ------------------------------ */
  /*  Mode live recording           */
  /* ------------------------------ */
  if (recording) {
    return (
      <div className="space-y-4">
        <div className="quote-warm">
          {recMode === "auto"
            ? "Enregistrement en cours — la vidéo sera envoyée au pipeline dès l'arrêt. Lis chaque case à voix haute pendant que Yoni pointe à la pastille fluo, puis dis la phrase finale et clique « Terminer »."
            : "Enregistrement en cours — la vidéo sera disponible en aperçu à la fin. Tu décideras ensuite de l'envoyer pour traitement, de la télécharger ou de recommencer."}
        </div>
        <div
          className="flex items-center gap-2"
          style={{ color: "var(--color-clay)" }}
        >
          <span className="pill-dot" style={{ background: "var(--color-clay)", animation: "rec-blink 1.2s ease-in-out infinite" }} />
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
  /*  Mode aperçu post-capture      */
  /* ------------------------------ */
  if (recordedBlob && recordedUrl) {
    const sizeMo = (recordedBlob.size / 1024 / 1024).toFixed(1);
    return (
      <div className="space-y-4">
        <div className="text-sm" style={{ color: "var(--color-ink-soft)" }}>
          Vérifie l'enregistrement, puis choisis : envoyer pour traitement (Claude reconstruit
          la phrase), télécharger en local, ou recommencer.
        </div>

        <div
          className="overflow-hidden"
          style={{
            background: "var(--color-ink)",
            borderRadius: "var(--radius-card)",
            maxHeight: 360,
          }}
        >
          <video
            src={recordedUrl}
            controls
            className="w-full max-h-[360px] object-contain"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="pill" style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}>
            {recordedFilename}
          </span>
          <span className="pill" style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}>
            {sizeMo} Mo
          </span>
        </div>

        {!calibrated && (
          <div className="banner-amber">
            La calibration n'est pas faite — l'envoi pour traitement est désactivé. Tu peux
            quand même télécharger la vidéo localement.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={sendForProcessing}
            disabled={uploading || !calibrated}
            className="btn-primary"
            title={!calibrated ? "Calibration requise" : undefined}
          >
            <IconCheck size={16} />
            <span>{uploading ? "Envoi…" : "Envoyer pour traitement"}</span>
          </button>
          <button onClick={downloadRecording} disabled={uploading} className="btn-ghost">
            <IconDownload size={16} />
            <span>Télécharger</span>
          </button>
          <button onClick={restart} disabled={uploading} className="btn-ghost">
            <IconRefresh size={14} />
            <span>Recommencer</span>
          </button>
        </div>

        {uploading && (
          <div className="space-y-2">
            <div className="banner-amber">
              Pipeline en cours (extraction frames, détection pastille, transcription audio,
              appel Claude). Compter 30 à 60 secondes — plus si premier lancement.
            </div>
            <div className="progress-indeterminate" aria-label="Traitement en cours" />
          </div>
        )}

        {error && <div className="banner-error">Erreur : {error}</div>}
      </div>
    );
  }

  /* ------------------------------ */
  /*  Mode initial                  */
  /* ------------------------------ */
  return (
    <div className="space-y-4">
      <div className="quote-warm">
        Mode lecture vocale : la personne près de Yoni lit chaque case à voix haute pendant
        qu'il pointe à la pastille fluo, puis dit la phrase finale.
      </div>

      {/* Action principale : enregistrer + traiter immédiatement */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => startRecording("auto")}
          disabled={!calibrated || uploading}
          className="btn-primary"
          title={!calibrated ? "Calibration requise pour le traitement automatique" : undefined}
        >
          <IconPlay size={14} />
          <span>Démarrer la session</span>
        </button>
        <button
          onClick={() => startRecording("preview")}
          disabled={uploading}
          className="btn-ghost"
        >
          <IconRecord size={10} style={{ color: "var(--color-clay)" }} />
          <span>Enregistrer une session</span>
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

      <div className="text-[12px]" style={{ color: "var(--color-ink-faint)" }}>
        <span className="font-mono">▸ Démarrer la session</span> envoie la vidéo
        directement au pipeline.
        <br />
        <span className="font-mono">● Enregistrer une session</span> ouvre un aperçu à la fin
        — tu décides alors d'envoyer ou télécharger.
      </div>

      {!calibrated && (
        <div className="banner-amber">
          Calibration requise pour le traitement automatique — tu peux toutefois enregistrer
          ou téléverser une vidéo et la garder en local.
        </div>
      )}

      {error && <div className="banner-error">Erreur : {error}</div>}
    </div>
  );
}
