import { useEffect, useState } from "react";
import { type AdminVideo, fetchAdminVideo } from "../../api/adminVideos";
import { type ActiveWork, type JobKind, remainingSeconds } from "../../api/jobs";
import { formatBytes, formatDuration, formatRemaining } from "../../lib/format";

// kindNames say what each kind of job does, in words for people.
export const kindNames: Record<JobKind, string> = {
  probe: "Lettura del video",
  details: "Informazioni dal file accanto",
  online: "Informazioni da internet",
  cover: "Copertina",
  preview: "Anteprime sulla barra",
  clip: "Anteprima sulla copertina",
  tracks: "Lingue e sottotitoli",
  translate: "Traduzione dei sottotitoli",
  transcribe: "Trascrizione con Whisper",
  convert: "Copia per i browser",
};

// kindShort are the same, short, for chips and the menu.
export const kindShort: Record<JobKind, string> = {
  probe: "Lettura",
  details: "Informazioni",
  online: "Internet",
  cover: "Copertina",
  preview: "Anteprime",
  clip: "Anteprima",
  tracks: "Lingue",
  translate: "Traduzione",
  transcribe: "Trascrizione",
  convert: "Copia",
};

// missingTool says which program a kind of job needs.
export const missingTool: Record<JobKind, string> = {
  probe: "ffprobe",
  details: "", // needs no other program: it is always available
  online: "", // the same
  cover: "ffmpeg",
  preview: "ffmpeg",
  clip: "ffmpeg",
  tracks: "ffmpeg", // and ffprobe, which "probe" already names
  translate: "", // the Sottotitoli page says how it is
  transcribe: "", // the same
  convert: "ffmpeg",
};

// The videos already asked for, so a picture is asked once per page view.
const known = new Map<number, Promise<AdminVideo>>();

// useJobVideo reads the video a job works on, for its picture and length.
// null while it comes, or when it cannot be read.
export function useJobVideo(id: number | null | undefined): AdminVideo | null {
  const [video, setVideo] = useState<AdminVideo | null>(null);
  useEffect(() => {
    setVideo(null);
    if (!id) return;
    let alive = true;
    let ask = known.get(id);
    if (!ask) {
      ask = fetchAdminVideo(id);
      known.set(id, ask);
      ask.catch(() => known.delete(id));
    }
    ask.then((v) => alive && setVideo(v)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  return video;
}

// forgetJobVideo drops what is known of a video, after it changed.
export function forgetJobVideo(id: number) {
  known.delete(id);
}

// stageNames say what a transcription is doing now.
export const stageNames: Record<string, string> = {
  audio: "Prendo l'audio",
  transcribe: "Whisper ascolta",
  translate: "Traduco",
  model: "Scarico il modello",
};

type Progress = Pick<ActiveWork, "kind" | "progress" | "doneSeconds" | "totalSeconds" | "seconds">;

// workPercent is how far some work is, from 0 to 100; null when it cannot
// tell (the bar then only moves).
export function workPercent(w: Progress): number | null {
  if (w.progress !== null) return w.progress;
  if (w.kind === "model" && w.doneSeconds !== null && w.totalSeconds && w.totalSeconds > 0)
    return (100 * w.doneSeconds) / w.totalSeconds;
  return null;
}

// progressText says how far some work is and how long it still takes:
// "42% · restano circa 3 min"; "" when it cannot tell.
export function progressText(w: Progress): string {
  const percent = workPercent(w);
  if (percent === null) return "";
  const left = remainingSeconds({ seconds: w.seconds, progress: percent });
  const shown = `${Math.floor(percent)}%`;
  return left === null || percent >= 100 ? shown : `${shown} · restano ${formatRemaining(left)}`;
}

// heardText says how much of a video whisper has listened to: "12:05 di
// 32:40 ascoltati"; "" when it cannot tell.
export function heardText(done: number | null, total: number | null): string {
  if (done === null || !total) return "";
  return `${formatDuration(Math.min(done, total))} di ${formatDuration(total)} ascoltati`;
}

// translatedText says how many sentences a translation has done: "12 di 40
// frasi"; "" when it cannot tell.
export function translatedText(done: number | null, total: number | null): string {
  if (done === null || !total) return "";
  return `${Math.min(done, total)} di ${total} frasi`;
}

// downloadedText says how much of a model has come: "12 MB di 36 MB"; "" when
// it cannot tell.
export function downloadedText(done: number | null, total: number | null): string {
  if (done === null || !total) return "";
  return `${formatBytes(Math.min(done, total))} di ${formatBytes(total)}`;
}

// workNumbers says how far a job is in its own unit: the sound listened to,
// the sentences translated, the bytes of a model; "" for the others.
export function workNumbers(job: {
  kind: JobKind;
  stage?: string;
  doneSeconds: number | null;
  totalSeconds: number | null;
}): string {
  if (job.kind === "transcribe") return heardText(job.doneSeconds, job.totalSeconds);
  if (job.kind === "translate" && job.stage === "model")
    return downloadedText(job.doneSeconds, job.totalSeconds);
  if (job.kind === "translate") return translatedText(job.doneSeconds, job.totalSeconds);
  return "";
}

// averagePercent is how far all the work going on is, together: the
// average of what can tell; null when nothing can.
export function averagePercent(active: Progress[]): number | null {
  const known = active.map(workPercent).filter((p): p is number => p !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0) / known.length;
}
