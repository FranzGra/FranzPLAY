import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

const later = {
  id: 1,
  kind: "later",
  name: "",
  owner: { id: 1, name: "Francesco" },
  public: false,
  videos: 1,
  cover: null,
  updatedAt: "2026-10-12T10:00:00Z",
};

describe("videos I like", () => {
  it("lists them on their page, the last liked first", async () => {
    const { server } = renderApp("/mi-piace", {
      ...signedIn(),
      "GET /api/likes": {
        body: { videos: [videoJSON({ id: 3, title: "Torta" }), videoJSON()], total: 2 },
      },
    });
    const list = await screen.findByRole("list", { name: "Video che ti piacciono" });
    expect(
      within(list)
        .getAllByRole("heading")
        .map((h) => h.textContent),
    ).toEqual(["Torta", "Mare 2024"]);
    const asked = server.requests.find((r) => r.url.includes("/api/likes"));
    expect(new URL(asked?.url ?? "").searchParams.get("limit")).toBe("24");
  });

  it("explains the page when nothing is liked yet", async () => {
    renderApp("/mi-piace", {
      ...signedIn(),
      "GET /api/likes": { body: { videos: [], total: 0 } },
    });
    expect(await screen.findByText("Nessun video ti piace ancora")).toBeInTheDocument();
  });

  it("shows them in a row on the Home, with the saved ones", async () => {
    renderApp("/", {
      ...signedIn(),
      "GET /api/likes": { body: { videos: [videoJSON({ id: 3, title: "Torta" })], total: 1 } },
      "GET /api/playlists": { body: [later] },
      "GET /api/playlists/1": {
        body: { playlist: later, videos: [videoJSON({ id: 4, title: "Da vedere" })] },
      },
    });
    const liked = await screen.findByRole("region", { name: "Ti piacciono" });
    expect(within(liked).getByRole("heading", { name: "Torta" })).toBeInTheDocument();
    expect(within(liked).getByRole("link", { name: "Vedi tutti: Ti piacciono" })).toHaveAttribute(
      "href",
      "/mi-piace",
    );
    const saved = await screen.findByRole("region", { name: "I tuoi salvati" });
    expect(within(saved).getByRole("heading", { name: "Da vedere" })).toBeInTheDocument();
    expect(within(saved).getByRole("link", { name: "Vedi tutti: I tuoi salvati" })).toHaveAttribute(
      "href",
      "/playlist/1",
    );
  });

  it("shows no rows on the Home when there is nothing to show", async () => {
    const { server } = renderApp("/", {
      ...signedIn(),
      "GET /api/likes": { body: { videos: [], total: 0 } },
      "GET /api/playlists": { body: [{ ...later, videos: 0 }] },
    });
    await screen.findByText("Ancora nessun video");
    expect(screen.queryByRole("region", { name: "Ti piacciono" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "I tuoi salvati" })).not.toBeInTheDocument();
    // An empty "Guarda più tardi" is not even opened.
    expect(server.requests.some((r) => r.url.endsWith("/api/playlists/1"))).toBe(false);
  });

  it("leads to them from the Playlist page", async () => {
    renderApp("/playlist", { ...signedIn(), "GET /api/playlists": { body: [later] } });
    const card = await within(await screen.findByRole("main")).findByRole("link", {
      name: /^Mi piace/,
    });
    expect(card).toHaveAttribute("href", "/mi-piace");
  });
});
