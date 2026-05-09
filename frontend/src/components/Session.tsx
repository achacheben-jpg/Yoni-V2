import { useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconDownload,
  IconPaperclip,
  IconPlay,
  IconRefresh,
  IconSquare,
} from "./Icon";
import type { ProcessResult } from "../types";

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
  const liveVideoRef = useRef<HTMLVideoElement>(null);

  // Aperçu post-capture (en attente d'une décision : envoyer / télécharger / recommencer)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedFilename, setRecordedFilename] = useState<string>("session.webm");

  // Pipeline upload
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Branche le flux live dès qu'il est prêt.
  useEffect(() => {
    if (liveVideoRef.current && stream) {
      liveVideoRef.current.srcObject = stream;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // URL d'aperçu pour la vidéo enregistrée.
  useEffect(() => {
    if (!recordedBlob) {
      setRecordedUrl(null);
      return;
    }
    const url = URL.createObjectURL(recordedBlob);
    setRecordedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordedBlob]);

  // Cleanup du flux si le composant se démonte pendant l'enregistrement.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setError(null);
    setRecordedBlob(null);
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
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: mr.mimeType || "video/webm" });
        s.getTracks().forEach((t) => t.stop());
        setStream(null);
        setRecorder(null);
        setRecording(false);
        // Option A : on STOCKE l'enregistrement et on attend la décision de l'utilisateur,
        // au lieu d'envoyer automatiquement au pipeline.
        setRecordedBlob(blob);
        setRecordedFilename(
          blob.type.includes("mp4") ? "session.mp4" : "session.webm",
        );
      };
      mr.start();
      setRecorder(mr);
      setRecording(true);
    } catch (e) {
      setError(`Caméra/micro inaccessibles : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stopRecording = () => {
    recorder?.stop();
  };

  const handleFile = (file: File) => {
    setRecordedBlob(file);
    setRecordedFilename(file.name);
    setError(null);
  };

  const sendForProcessing = async () => {
    if (!recordedBlob) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("video", recordedBlob, recordedFilename);
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
      setRecordedBlob(null); // l'aperçu disparaît après envoi réussi
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
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
          Enregistrement en cours. Lis chaque case à voix haute pendant que Yoni pointe à la
          pastille fluo, puis dis la phrase finale et clique « Terminer ».
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
        <div
          className="text-sm"
          style={{ color: "var(--color-ink-soft)" }}
        >
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
          <span
            className="pill"
            style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}
          >
            {recordedFilename}
          </span>
          <span
            className="pill"
            style={{ background: "var(--color-canvas)", color: "var(--color-ink-soft)" }}
          >
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

      {!calibrated && (
        <div className="banner-amber">
          Calibration requise pour le traitement automatique — tu peux toutefois enregistrer
          ou téléverser une vidéo et la garder en local.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={startRecording} className="btn-primary">
          <IconPlay size={14} />
          <span>Démarrer la session</span>
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

      {error && <div className="banner-error">Erreur : {error}</div>}
    </div>
  );
}
