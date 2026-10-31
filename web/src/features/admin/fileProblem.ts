import type { FileProblem } from "../../api/adminVideos";

// fileProblemText says why a file cannot be read, in words for whoever looks
// at the disk, not at ffprobe.
export const fileProblemText: Record<Exclude<FileProblem, "">, string> = {
  damaged: "Il file è rovinato o incompleto: forse la copia si è interrotta a metà.",
  no_video: "Il file non contiene immagini: è solo audio, oppure non è un video.",
  unreadable: "FranzPLAY non riesce ad aprire questo file: forse è rovinato o non ha il permesso.",
};
