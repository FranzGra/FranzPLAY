import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

describe("video page", () => {
  it("shows the player, the details and other videos of the category", async () => {
    const { server } = renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON() },
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
});
