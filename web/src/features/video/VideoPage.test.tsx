import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

describe("video page", () => {
  it("shows the player, the details and other videos of the category", async () => {
    const { server } = renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON() },
      "GET /api/videos/7/progress": { body: { position: 0, finished: false } },
      "GET /api/videos/7/subtitles": {
        body: [
          { key: "it.srt", lang: "it", label: "Italiano", src: "/api/videos/7/subtitles/it.srt" },
        ],
      },
      "GET /api/videos": {
        body: { videos: [videoJSON(), videoJSON({ id: 8, title: "Montagna" })], total: 2 },
      },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Mare 2024" })).toBeInTheDocument();
    expect(document.querySelector("video")).toHaveAttribute("src", "/api/videos/7/stream");
    expect(screen.getByRole("link", { name: "Vacanze" })).toHaveAttribute(
      "href",
      "/categorie/Vacanze",
    );
    expect(screen.getByText(/1080p/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sottotitoli (c)" })).toBeEnabled();
    expect(document.querySelector("track")).toHaveAttribute(
      "src",
      "/api/videos/7/subtitles/it.srt",
    );

    const side = screen.getByRole("complementary", { name: "Altri video" });
    expect(await within(side).findByRole("heading", { name: "Montagna" })).toBeInTheDocument();
    expect(within(side).queryByRole("heading", { name: "Mare 2024" })).not.toBeInTheDocument();
    const list = server.requests.find((r) => new URL(r.url).pathname === "/api/videos");
    expect(new URL(list?.url ?? "").searchParams.get("category")).toBe("Vacanze");
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
