import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn, testAccount } from "../../test/render";

const list = {
  id: 2,
  kind: "playlist",
  name: "Gite",
  owner: { id: 5, name: "Giulia" },
  public: true,
  videos: 3,
  cover: null,
  updatedAt: "2026-10-12T09:00:00Z",
};
const channel = (over: Record<string, unknown> = {}) => ({
  id: 5,
  name: "Giulia",
  avatar: 0,
  since: "2026-03-10T09:00:00Z",
  playlists: [list],
  ...over,
});

describe("channel page", () => {
  it("shows a person and their public playlists", async () => {
    renderApp("/canale/5", { ...signedIn(), "GET /api/channels/5": { body: channel() } });
    expect(await screen.findByRole("heading", { level: 1, name: "Giulia" })).toBeInTheDocument();
    expect(screen.getByText("Su FranzPLAY da marzo 2026")).toBeInTheDocument();
    const card = screen.getByRole("link", { name: /Gite/ });
    expect(card).toHaveAttribute("href", "/playlist/2");
    expect(within(card).getByText("Playlist · 3 video")).toBeInTheDocument();
  });

  it("shows the videos the person uploaded", async () => {
    const { server } = renderApp("/canale/5", {
      ...signedIn(),
      "GET /api/channels/5": { body: channel() },
      "GET /api/videos": {
        body: {
          videos: [videoJSON({ title: "Al mare", uploader: { id: 5, name: "Giulia" } })],
          total: 1,
        },
      },
    });
    const videos = await screen.findByRole("list", { name: "Video caricati da Giulia" });
    expect(within(videos).getByText("Al mare")).toBeInTheDocument();
    const asked = server.requests.find((r) => r.url.includes("/api/videos"));
    expect(new URL(asked?.url ?? "").searchParams.get("uploader")).toBe("5");
  });

  it("shows me all my videos, each saying who sees it", async () => {
    renderApp("/canale/1", {
      ...signedIn(),
      "GET /api/channels/1": { body: channel({ id: 1, name: "Paolo" }) },
      "GET /api/videos": {
        body: {
          videos: [
            videoJSON({ id: 1, title: "Per tutti", audience: "everyone" }),
            videoJSON({ id: 2, title: "Col link", private: true, audience: "link" }),
            videoJSON({ id: 3, title: "Per Anna", private: true, audience: "people" }),
            videoJSON({ id: 4, title: "Solo mio", private: true, audience: "me" }),
          ],
          total: 4,
        },
      },
    });
    const videos = await screen.findByRole("list", { name: "I tuoi video" });
    expect(screen.getByRole("heading", { level: 2, name: "I tuoi video" })).toBeInTheDocument();
    expect(screen.getByText(/Gli altri vedono solo quelli pubblici/)).toBeInTheDocument();
    for (const [title, label] of [
      ["Per tutti", "Pubblico"] as const,
      ["Col link", "Chi ha il link"],
      ["Per Anna", "Alcune persone"],
      ["Solo mio", "Privato"],
    ]) {
      const card = within(videos).getByRole("link", { name: new RegExp(title) });
      expect(card).toHaveTextContent(`Chi lo vede: ${label}`);
    }
  });

  it("shows no videos box for who never uploaded one", async () => {
    renderApp("/canale/5", {
      ...signedIn(),
      "GET /api/channels/5": { body: channel() },
      "GET /api/videos": { body: { videos: [], total: 0 } },
    });
    await screen.findByRole("heading", { level: 2, name: "Playlist" });
    expect(screen.queryByRole("heading", { name: "Video" })).not.toBeInTheDocument();
  });

  it("tells me where my uploaded videos will appear", async () => {
    renderApp("/canale/1", {
      ...signedIn({ ...testAccount, canUpload: true }),
      "GET /api/channels/1": { body: channel({ id: 1, name: "Paolo" }) },
      "GET /api/videos": { body: { videos: [], total: 0 } },
    });
    expect(await screen.findByText("Nessun video caricato")).toBeInTheDocument();
  });

  it("shows the person's photo when they have one", async () => {
    renderApp("/canale/5", {
      ...signedIn(),
      "GET /api/channels/5": { body: channel({ avatar: 77 }) },
    });
    await screen.findByRole("heading", { level: 1, name: "Giulia" });
    expect(document.querySelector('img[src="/api/users/5/avatar?v=77"]')).not.toBeNull();
  });

  it("explains an empty channel to someone else", async () => {
    renderApp("/canale/5", {
      ...signedIn(),
      "GET /api/channels/5": { body: channel({ playlists: [] }) },
    });
    expect(await screen.findByText("Nessuna playlist pubblica")).toBeInTheDocument();
  });

  it("tells me how to fill my own channel", async () => {
    renderApp("/canale/1", {
      ...signedIn(),
      "GET /api/channels/1": { body: channel({ id: 1, name: "Paolo", playlists: [] }) },
    });
    expect(await screen.findByText("Il tuo canale è ancora vuoto")).toBeInTheDocument();
    expect(screen.getByText(/questo è il tuo canale/)).toBeInTheDocument();
  });

  it("says when the person is not there", async () => {
    renderApp("/canale/99", {
      ...signedIn(),
      "GET /api/channels/99": { status: 404, body: { error: "channel not found" } },
    });
    expect(await screen.findByRole("heading", { name: "Canale non trovato" })).toBeInTheDocument();
  });

  it("is reached from the side menu", async () => {
    renderApp("/", signedIn());
    const menu = await screen.findByRole("navigation", { name: "Menu principale" });
    expect(within(menu).getByRole("link", { name: "Il mio canale" })).toHaveAttribute(
      "href",
      "/canale/1",
    );
  });

  it("lets me manage the public links of my videos only with the permission", async () => {
    const routes = (canSharePublic: boolean) => ({
      ...signedIn({ ...testAccount, role: "user", canSharePublic }),
      "GET /api/channels/1": { body: channel({ id: 1, name: "Paolo" }) },
      "GET /api/videos": {
        body: {
          videos: [
            videoJSON({
              id: 1,
              title: "Al mare",
              uploader: { id: 1, name: "Paolo" },
              publicLink: canSharePublic ? "/p/abcdefghijklmnopqrstuv" : undefined,
            }),
          ],
          total: 1,
        },
      },
    });
    const { unmount } = renderApp("/canale/1", routes(false));
    await screen.findByRole("heading", { name: "Al mare" });
    expect(screen.queryByRole("button", { name: /Link pubblico/ })).not.toBeInTheDocument();
    unmount();

    const { user } = renderApp("/canale/1", routes(true));
    await screen.findByRole("heading", { name: "Al mare" });
    expect(screen.getByText("Pubblico")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Link pubblico di Al mare" }));
    expect(screen.getByRole("textbox", { name: "Link del video" })).toHaveValue(
      `${window.location.origin}/p/abcdefghijklmnopqrstuv`,
    );
    expect(screen.getByRole("button", { name: "Copia link" })).toBeInTheDocument();
  });
});
