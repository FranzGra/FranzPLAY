import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

describe("video page", () => {
  it("shows the player, the details and the videos to watch after", async () => {
    renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON() },
      "GET /api/videos/7/progress": { body: { position: 0, finished: false } },
      "GET /api/videos/7/subtitles": {
        body: [
          { key: "it.srt", lang: "it", label: "Italiano", src: "/api/videos/7/subtitles/it.srt" },
        ],
      },
      "GET /api/videos/7/similar": {
        body: [{ video: videoJSON({ id: 8, title: "Montagna" }), reason: "watchedTogether" }],
      },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Mare 2024" })).toBeInTheDocument();
    expect(document.querySelector("video")).toHaveAttribute("src", "/api/videos/7/stream");
    expect(screen.getByRole("link", { name: "Vacanze" })).toHaveAttribute(
      "href",
      "/categorie/Vacanze",
    );
    expect(screen.getByText(/1080p · MP4/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sottotitoli (c)" })).toBeEnabled();
    expect(screen.getByText(/1080p · MP4 · Sottotitoli IT$/)).toBeInTheDocument();
    expect(document.querySelector("track")).toHaveAttribute(
      "src",
      "/api/videos/7/subtitles/it.srt",
    );

    const side = screen.getByRole("complementary", { name: "Altri video" });
    expect(await within(side).findByRole("heading", { name: "Montagna" })).toBeInTheDocument();
    expect(within(side).getByText("Visto da chi ha visto questo")).toBeInTheDocument();
  });

  it("shows what the file next to the video says: author, day and description", async () => {
    const { user } = renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": {
        body: videoJSON({
          title: "Gita in montagna",
          author: "Famiglia Rossi",
          publishedOn: "2019-03-15",
          description: `Prima riga\nSeconda riga\nTerza riga\nQuarta riga, nascosta all'inizio`,
        }),
      },
    });
    expect(await screen.findByText(/Famiglia Rossi · 15 marzo 2019/)).toBeInTheDocument();
    const box = screen.getByRole("region", { name: "Descrizione" });
    expect(within(box).queryByText(/Quarta riga/)).not.toBeInTheDocument();
    await user.click(within(box).getByRole("button", { name: "Mostra altro" }));
    expect(within(box).getByText(/Quarta riga/)).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Mostra meno" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps a private video to its few people: likes and comments, no playlists, link or suggestions", async () => {
    const { server } = renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON({ private: true }) },
      "GET /api/videos/7/like": { body: { liked: false, count: 0 } },
      "GET /api/videos/7/comments": { body: [] },
    });
    expect(await screen.findByText(/Solo tu vedi questo video/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Carica un video" })).toHaveAttribute(
      "href",
      "/carica",
    );
    expect(await screen.findByRole("button", { name: /Mi piace/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salva/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Condividi/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Altri video" })).not.toBeInTheDocument();
    const asked = server.requests.map((r) => new URL(r.url).pathname);
    expect(asked.some((p) => p.endsWith("/similar"))).toBe(false);
  });

  it("tells the uploader who else sees a shared video", async () => {
    renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": {
        body: videoJSON({
          private: true,
          uploader: { id: 1, name: "Francesco" },
          sharedWith: [
            { id: 3, name: "Anna", avatar: 0 },
            { id: 4, name: "Marco", avatar: 0 },
          ],
        }),
      },
    });
    expect(
      await screen.findByText(/Questo video lo vedete solo tu, Anna e Marco\./),
    ).toBeInTheDocument();
  });

  it("tells who received a shared video that few see it", async () => {
    renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": {
        body: videoJSON({ private: true, uploader: { id: 5, name: "Giulia" } }),
      },
    });
    expect(
      await screen.findByText(/Giulia ha condiviso questo video solo con alcune persone/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Carica un video" })).not.toBeInTheDocument();
  });

  it("says whose the video is, with their photo and a link to their channel", async () => {
    renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": {
        body: videoJSON({
          uploader: { id: 5, name: "Giulia" },
          owner: { id: 5, name: "Giulia", avatar: 42 },
        }),
      },
    });
    const owner = await screen.findByRole("link", { name: "Giulia" });
    expect(owner).toHaveAttribute("href", "/canale/5");
    expect(owner.querySelector("img")).toHaveAttribute("src", "/api/users/5/avatar?v=42");
  });

  it("shows the initial of an owner without a photo", async () => {
    renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON({ owner: { id: 1, name: "anna", avatar: 0 } }) },
    });
    const owner = await screen.findByRole("link", { name: "anna" });
    expect(owner).toHaveAttribute("href", "/canale/1");
    expect(owner.querySelector("img")).toBeNull();
    expect(owner).toHaveTextContent("Aanna");
  });

  it("switches to theater mode with its button or the t key, and remembers it", async () => {
    const { user, unmount } = renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON() },
    });
    const frame = () => document.querySelector("[data-width]");
    await user.click(await screen.findByRole("button", { name: "Modalità Teatro (t)" }));
    expect(frame()).toHaveAttribute("data-width", "full");
    expect(document.querySelector("[data-theater]")).toHaveAttribute("data-theater", "on");
    expect(localStorage.getItem("franzplay.theater")).toBe("true");

    fireEvent.keyDown(document.body, { key: "t" });
    expect(frame()).toHaveAttribute("data-width", "wide");
    expect(screen.getByRole("button", { name: "Modalità Teatro (t)" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "T" });
    expect(screen.getByRole("button", { name: "Visualizzazione normale (t)" })).toBeInTheDocument();
    unmount();

    // The next video opens in theater mode too; other pages are as usual.
    renderApp("/video/7", { ...signedIn(), "GET /api/videos/7": { body: videoJSON() } });
    expect(
      await screen.findByRole("button", { name: "Visualizzazione normale (t)" }),
    ).toBeInTheDocument();
    expect(frame()).toHaveAttribute("data-width", "full");
  });

  it("shows no description box when there is none", async () => {
    renderApp("/video/7", { ...signedIn(), "GET /api/videos/7": { body: videoJSON() } });
    expect(await screen.findByRole("heading", { level: 1, name: "Mare 2024" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Descrizione" })).not.toBeInTheDocument();
  });

  it("says when a video does not exist", async () => {
    renderApp("/video/99", {
      ...signedIn(),
      "GET /api/videos/99": { status: 404, body: { error: "video not found" } },
    });
    expect(await screen.findByRole("heading", { name: "Video non trovato" })).toBeInTheDocument();
  });

  it("does not ask the server for an address that is not a video", async () => {
    const { server } = renderApp("/video/abc");
    expect(await screen.findByRole("heading", { name: "Video non trovato" })).toBeInTheDocument();
    expect(server.requests.some((r) => r.url.includes("/api/videos/"))).toBe(false);
  });

  it("explains a server that does not answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { status: 500, body: { error: "internal error" } },
    });
    expect(
      await screen.findByRole("heading", { name: "Video non disponibile" }),
    ).toBeInTheDocument();
  });

  it("starts where the video was left and remembers where it stops", async () => {
    const { server } = renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON() },
      "GET /api/videos/7/progress": { body: { position: 100, finished: false } },
      "GET /api/videos/7/subtitles": { body: [] },
      "POST /api/videos/7/progress": { body: { position: 130, finished: false } },
    });
    await screen.findByRole("heading", { level: 1, name: "Mare 2024" });
    const video = document.querySelector("video") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(100);

    fireEvent.play(video);
    video.currentTime = 130;
    fireEvent.timeUpdate(video);
    fireEvent.pause(video);
    await waitFor(() => expect(server.requests.some((r) => r.method === "POST")).toBe(true));
    const sent = server.requests.find((r) => r.method === "POST");
    expect(await sent?.json()).toEqual({ position: 130 });
  });

  it("plays from the start when the position does not load", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON() },
      "GET /api/videos/7/progress": { status: 500, body: { error: "internal error" } },
      "GET /api/videos/7/subtitles": { body: [] },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Mare 2024" })).toBeInTheDocument();
    const video = document.querySelector("video") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
    expect(error).toHaveBeenCalled();
  });
});
