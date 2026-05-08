import { useEffect, useRef, useState } from "react";
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
        // FastAPI renvoie souvent du JSON d'erreur lisible.
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
      <p className="text-sm text-amber-700">
        Calibration requise avant de démarrer une session. Calibre d'abord (section 1).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Mode lecture vocale : la personne près de Yoni lit chaque case à voix haute pendant
        qu'elle pointe à la pastille fluo, puis dit la phrase finale.
      </p>

      {recording && stream && (
        <div className="rounded border border-slate-300 overflow-hidden bg-black">
          <video ref={videoRef} muted playsInline className="w-full max-h-72 object-contain" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!recording ? (
          <button
            onClick={startRecording}
            disabled={uploading}
            className="px-5 py-3 rounded bg-green-600 text-white font-semibold disabled:bg-slate-300 disabled:text-slate-500 min-h-[44px]"
          >
            ▶ Démarrer la session
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="px-5 py-3 rounded bg-red-600 text-white font-semibold min-h-[44px]"
          >
            ■ Terminer et uploader
          </button>
        )}

        <label
          className={
            "px-4 py-3 rounded border border-slate-300 bg-white text-sm cursor-pointer min-h-[44px] inline-flex items-center " +
            (uploading || recording ? "opacity-50 pointer-events-none" : "hover:bg-slate-50")
          }
        >
          📁 Uploader un .mov/.mp4
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
        <div className="rounded bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          Pipeline en cours (extraction frames, détection pastille, transcription audio, appel
          Claude). Ça prend généralement 30 à 60 secondes…
        </div>
      )}

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          Erreur : {error}
        </div>
      )}
    </div>
  );
}
