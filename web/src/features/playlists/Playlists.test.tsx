import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

const later = {
  id: 1,
  kind: "later",
  name: "",
  videos: 0,
  cover: null,
  updatedAt: "2026-10-12T09:00:00Z",
};
const trips = {
  ...later,
  id: 2,
  kind: "playlist",
  name: "Gite",
  videos: 2,
  cover: "/api/covers/a.jpg",
};

async function bodyOf(request: Request | undefined): Promise<unknown> {
  return request ? JSON.parse(await request.clone().text()) : undefined;
}

describe("playlists page", () => {
  it("shows watch later first, then my lists", async () => {
    renderApp("/playlist", { ...signedIn(), "GET /api/playlists": { body: [later, trips] } });
    const links = await screen.findAllByRole("link", { name: /Guarda più tardi|Gite/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/playlist/1", "/playlist/2"]);
    expect(within(links[1] as HTMLElement).getByText("2 video")).toBeInTheDocument();
    expect(screen.queryByText(/Per fare una playlist/)).not.toBeInTheDocument();
  });

  it("makes a new list", async () => {
    const { user, server } = renderApp("/playlist", {
      ...signedIn(),
      "GET /api/playlists": { body: [later] },
      "POST /api/playlists": {
        status: 201,
        body: { ...trips, name: "Feste", videos: 0, cover: null },
      },
    });
    expect(await screen.findByText(/Per fare una playlist/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nuova playlist" }));
    await user.type(screen.getByRole("textbox", { name: "Nome della playlist" }), "Feste{Enter}");
    expect(await screen.findByRole("link", { name: /Feste/ })).toHaveAttribute(
      "href",
      "/playlist/2",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(await bodyOf(server.requests.find((r) => r.method === "POST"))).toEqual({
      name: "Feste",
    });
  });
});

describe("playlist page", () => {
  const page = {
    playlist: trips,
    videos: [videoJSON(), videoJSON({ id: 8, title: "Montagna" })],
  };

  it("shows the videos in order and takes one out", async () => {
    const { user, server } = renderApp("/playlist/2", {
      ...signedIn(),
      "GET /api/playlists/2": { body: page },
      "DELETE /api/playlists/2/videos/7": { status: 204 },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Gite" })).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(
      within(list)
        .getAllByRole("heading")
        .map((h) => h.textContent),
    ).toEqual(["Mare 2024", "Montagna"]);
    await user.click(screen.getByRole("button", { name: "Togli «Mare 2024» dalla playlist" }));
    expect(await screen.findByText("1 video")).toBeInTheDocument();
    expect(screen.queryByText("Mare 2024")).not.toBeInTheDocument();
    expect(server.requests.at(-1)?.method).toBe("DELETE");
  });

  it("renames a list", async () => {
    const { user, server } = renderApp("/playlist/2", {
      ...signedIn(),
      "GET /api/playlists/2": { body: page },
      "PUT /api/playlists/2": { status: 204 },
    });
    await user.click(await screen.findByRole("button", { name: "Rinomina" }));
    const box = screen.getByRole("textbox", { name: "Nome della playlist" });
    expect(box).toHaveValue("Gite");
    await user.clear(box);
    await user.type(box, "Gite  al mare{Enter}");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Gite al mare" }),
    ).toBeInTheDocument();
    expect(await bodyOf(server.requests.find((r) => r.method === "PUT"))).toEqual({
      name: "Gite  al mare",
    });
  });

  it("deletes a list after asking", async () => {
    const { user } = renderApp("/playlist/2", {
      ...signedIn(),
      "GET /api/playlists/2": { body: page },
      "DELETE /api/playlists/2": { status: 204 },
      "GET /api/playlists": { body: [later] },
    });
    await user.click(await screen.findByRole("button", { name: "Elimina" }));
    expect(screen.getByText(/I video restano nella libreria/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sì, elimina" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Playlist" })).toBeInTheDocument();
  });

  it("does not rename or delete watch later", async () => {
    renderApp("/playlist/1", {
      ...signedIn(),
      "GET /api/playlists/1": { body: { playlist: later, videos: [] } },
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Guarda più tardi" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Niente da guardare più tardi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rinomina" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("says when a list is not there", async () => {
    renderApp("/playlist/99", {
      ...signedIn(),
      "GET /api/playlists/99": { status: 404, body: { error: "playlist not found" } },
    });
    expect(
      await screen.findByRole("heading", { name: "Playlist non trovata" }),
    ).toBeInTheDocument();
  });
});
