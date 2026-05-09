import { useEffect, useRef, useState } from "react";
import { IconPaperclip, IconPlay, IconSquare } from "./Icon";
import type { ProcessResult } from "../types";

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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  const startRecording = async () => {
    setError(null);
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
        await sendVideo(blob, blob.type.includes("mp4") ? "session.mp4" : "session.webm");
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

  const handleFile = async (file: File) => {
    await sendVideo(file, file.name);
  };

  const sendVideo = async (blob: Blob, filename: string) => {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  if (!calibrated) {
    return (
      <div className="banner-amber">
        Calibration requise avant de démarrer une session — passe à la section <strong>I. Calibration</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="quote-warm">
        Mode lecture vocale : la personne près de Yoni lit chaque case à voix haute pendant qu'il
        pointe à la pastille fluo, puis dit la phrase finale.
      </div>

      {recording && stream && (
        <div
          className="overflow-hidden"
          style={{
            background: "var(--color-ink)",
            borderRadius: "var(--radius-card)",
            maxHeight: 320,
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full max-h-80 object-contain"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!recording ? (
          <button
            onClick={startRecording}
            disabled={uploading}
            className="btn-primary"
          >
            <IconPlay size={14} />
            <span>Démarrer la session</span>
          </button>
        ) : (
          <button onClick={stopRecording} className="btn-danger">
            <IconSquare size={12} />
            <span>Terminer et uploader</span>
          </button>
        )}

        <label className={"btn-ghost cursor-pointer " + ((uploading || recording) ? "opacity-50 pointer-events-none" : "")}>
          <IconPaperclip size={14} />
          <span>Uploader un .mov / .mp4</span>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            disabled={uploading || recording}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {uploading && (
        <div className="space-y-2">
          <div className="banner-amber">
            Pipeline en cours (extraction frames, détection pastille, transcription audio, appel
            Claude). Compter 30 à 60 secondes — plus si premier lancement.
          </div>
          <div className="progress-indeterminate" aria-label="Traitement en cours" />
        </div>
      )}

      {error && <div className="banner-error">Erreur : {error}</div>}
    </div>
  );
}
