import type { Upload } from "../../api/uploads";
import { fakeServer } from "../../test/render";
import { alreadyThere, sendFile, UploadGone } from "./sendFile";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// pretendServer keeps one upload and answers like the real server. trouble
// decides, for each piece, whether something goes wrong instead.
function pretendServer(size: number, trouble: (call: number) => "drop" | "cut" | "busy" | null) {
  const upload: Upload = {
    id: 4,
    name: "mare.mp4",
    title: "Al mare",
    size,
    received: 0,
    private: false,
  };
  let bytes = "";
  let calls = 0;
  const server = fakeServer({
    "GET /api/uploads": () =>
      json({ space: { quota: 1000, used: 0, reserved: size }, uploads: [upload] }),
    "PUT /api/uploads/4": async (request) => {
      const piece = await request.text();
      const offset = Number(new URL(request.url).searchParams.get("offset"));
      switch (trouble(calls++)) {
        case "drop":
          throw new TypeError("Failed to fetch");
        case "cut":
          // Half the piece arrived, then the connection dropped.
          return json({ error: "receive upload: unexpected EOF" }, 500);
        case "busy":
          return json({ error: "another piece of this upload is arriving" }, 409);
      }
      if (offset !== upload.received) {
        return json({ error: "this piece does not start where the upload is" }, 409);
      }
      bytes += piece;
      upload.received += piece.length;
      return json(upload.received === size ? { ...upload, video: 9 } : upload);
    },
  });
  return { upload, server, bytes: () => bytes };
}

const noWait = () => Promise.resolve();

describe("sendFile", () => {
  const content = "abcdefghijklmnopqrstuvwxyz";
  const file = new Blob([content]);

  it("sends the file in pieces and returns its video", async () => {
    const { upload, bytes } = pretendServer(content.length, () => null);
    const seen: number[] = [];
    const done = await sendFile(
      file,
      { ...upload },
      {
        signal: new AbortController().signal,
        onProgress: (n) => seen.push(n),
        pieceSize: 10,
        wait: noWait,
      },
    );
    expect(done.video).toBe(9);
    expect(bytes()).toBe(content);
    expect(seen).toEqual([10, 20, 26]);
  });

  it("goes on from where the server is after a dropped connection", async () => {
    const { upload, bytes } = pretendServer(content.length, (call) =>
      call === 1 ? "drop" : call === 2 ? "cut" : null,
    );
    const waits: number[] = [];
    const done = await sendFile(
      file,
      { ...upload },
      {
        signal: new AbortController().signal,
        onProgress: () => {},
        pieceSize: 10,
        wait: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(done.video).toBe(9);
    expect(bytes()).toBe(content);
    // A little longer after each failure in a row.
    expect(waits).toEqual([1000, 2000]);
  });

  it("starts from what already arrived", async () => {
    const { upload, server, bytes } = pretendServer(content.length, () => null);
    upload.received = 10; // from an earlier visit
    await sendFile(
      file,
      { ...upload },
      {
        signal: new AbortController().signal,
        onProgress: () => {},
        pieceSize: 100,
        wait: noWait,
      },
    );
    expect(bytes()).toBe(content.slice(10));
    expect(new URL(server.requests[0]?.url ?? "").searchParams.get("offset")).toBe("10");
  });

  it("gives up after failing again and again", async () => {
    const { upload } = pretendServer(content.length, () => "drop");
    await expect(
      sendFile(file, upload, {
        signal: new AbortController().signal,
        onProgress: () => {},
        wait: noWait,
      }),
    ).rejects.toThrow("Failed to fetch");
  });

  it("stops at once when the video is already there", async () => {
    const server = fakeServer({ "PUT /api/uploads/4": () => json({ error: alreadyThere }, 409) });
    const upload = { id: 4, name: "a.mp4", title: "a", size: 3, received: 0, private: false };
    await expect(
      sendFile(new Blob(["abc"]), upload, {
        signal: new AbortController().signal,
        onProgress: () => {},
        wait: noWait,
      }),
    ).rejects.toThrow(alreadyThere);
    expect(server.requests).toHaveLength(1);
  });

  it("says when the server no longer has the upload", async () => {
    fakeServer({
      "PUT /api/uploads/4": () => json({ error: "receive upload: disk full" }, 500),
      "GET /api/uploads": () => json({ space: { quota: 1, used: 0, reserved: 0 }, uploads: [] }),
    });
    const upload = { id: 4, name: "a.mp4", title: "a", size: 3, received: 0, private: false };
    await expect(
      sendFile(new Blob(["abc"]), upload, {
        signal: new AbortController().signal,
        onProgress: () => {},
        wait: noWait,
      }),
    ).rejects.toBeInstanceOf(UploadGone);
  });
});
