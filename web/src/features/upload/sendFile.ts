import { ApiError } from "../../api/client";
import { fetchMyUploads, sendPiece, type Upload } from "../../api/uploads";

// pieceSize is how much of the file goes in one request. If the connection
// drops, at most one piece is sent again.
export const pieceSize = 8 * 1024 * 1024;

// tries is how many times in a row a piece is tried before giving up.
const tries = 6;

// The server's words when the video is already on FranzPLAY.
export const alreadyThere = "this video is already on FranzPLAY";

// UploadGone means the server no longer has the upload: it was cancelled,
// or left alone for days, or it ended while the answer got lost.
export class UploadGone extends Error {
  constructor() {
    super("the upload is no longer on the server");
    this.name = "UploadGone";
  }
}

type Options = {
  onProgress: (received: number) => void;
  signal: AbortSignal;
  // wait pauses before trying again; tests make it instant.
  wait?: (ms: number) => Promise<void>;
  pieceSize?: number;
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// retryable reports whether trying again may help: a dropped connection,
// a server that is restarting, or a piece the server did not expect.
function retryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.status === 409) return error.message !== alreadyThere;
  return error.status >= 500;
}

// sendFile sends what is missing of file, piece after piece, starting from
// what the server already has. When something goes wrong it waits a little
// longer each time (1, 2, 4… seconds), asks the server how much arrived and
// goes on from there. It returns the upload with its new video.
export async function sendFile(file: Blob, upload: Upload, options: Options): Promise<Upload> {
  const { onProgress, signal, wait = pause, pieceSize: size = pieceSize } = options;
  let offset = upload.received;
  let failures = 0;
  for (;;) {
    // When everything arrived but the end went wrong, an empty piece asks
    // the server to finish.
    const piece = file.slice(offset, Math.min(offset + size, upload.size));
    try {
      const now = await sendPiece(upload.id, offset, piece, signal);
      failures = 0;
      offset = now.received;
      onProgress(offset);
      if (now.video !== undefined) return now;
    } catch (error) {
      if (signal.aborted || !retryable(error)) throw error;
      failures++;
      if (failures >= tries) throw error;
      await wait(1000 * 2 ** (failures - 1));
      offset = await whereIs(upload.id, offset, signal);
      onProgress(offset);
    }
  }
}

// whereIs asks the server how much of an upload arrived. When the server
// cannot answer either, the next piece will find out.
async function whereIs(id: number, guess: number, signal: AbortSignal): Promise<number> {
  let mine: Awaited<ReturnType<typeof fetchMyUploads>>;
  try {
    mine = await fetchMyUploads(signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return guess;
  }
  const upload = mine.uploads.find((u) => u.id === id);
  if (!upload) throw new UploadGone();
  return upload.received;
}
