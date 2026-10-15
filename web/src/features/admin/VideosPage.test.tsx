import { act, screen, waitFor, within } from "@testing-library/react";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

function adminVideo(overrides: Record<string, unknown> = {}) {
  return {
    ...videoJSON(),
    folder: "/media/video",
    path: "Vacanze/Mare 2024.mp4",
    hidden: false,
    missing: false,
    tooShort: false,
    foundTitle: "Mare 2024",
    foundCategory: "Vacanze",
    titleSet: false,
    categorySet: false,
    coverChoice: "",
    coverSecond: null,
    clipChoice: "",
    videoCodec: "h264",
    audioCodec: "aac",
    hasCopy: false,
    ...overrides,
  };
}

function rowOf(name: string) {
  const list = screen.getByRole("list", { name: "Video" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByText(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("videos page", () => {
  it("shows each video light: a line about it, a few states, one action", async () => {
    renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [
            adminVideo(),
            adminVideo({
              id: 8,
              title: "Segreto",
              hidden: true,
              publicLink: "/p/abcdefghijklmnopqrstuv",
            }),
            adminVideo({ id: 9, title: "Perso", missing: true, duration: null, cover: null }),
          ],
          total: 3,
        },
      },
    });
    await screen.findByRole("list", { name: "Video" });
    const sea = rowOf("Mare 2024");
    expect(sea).toHaveTextContent("Vacanze · 4:05 · 1080p");
    // One action in the row, and the title opens the same page.
    expect(within(sea).queryAllByRole("button")).toEqual([]);
    const links = within(sea).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/admin/video/7", "/admin/video/7"]);
    expect(within(sea).getByRole("link", { name: "Modifica Mare 2024" })).toBeInTheDocument();
    expect(rowOf("Segreto")).toHaveTextContent("Nascosto");
    expect(rowOf("Segreto")).toHaveTextContent("Pubblico");
    expect(rowOf("Perso")).toHaveTextContent("Non trovato");
    expect(rowOf("Perso")).toHaveTextContent("Non ancora letto");
    expect(screen.getByText("3 video")).toBeInTheDocument();
  });

  it("says who uploaded a video and when only they see it", async () => {
    renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [
            adminVideo({
              title: "Al mare",
              folder: "/data/uploads",
              path: "5/3.mp4",
              private: true,
              uploader: { id: 5, name: "Giulia" },
            }),
          ],
          total: 1,
        },
      },
    });
    const row = await screen.findByRole("listitem");
    expect(within(row).getByText(/Caricato da Giulia/)).toBeInTheDocument();
    expect(within(row).getByText("Solo per chi l'ha caricato")).toBeInTheDocument();
  });

  it("shows the videos as a table, one action per row, and remembers it", async () => {
    const routes = {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [adminVideo(), adminVideo({ id: 8, title: "Film", hidden: true, hasCopy: true })],
          total: 2,
        },
      },
    };
    const { user, unmount } = renderApp("/admin/video", routes);
    await screen.findByRole("list", { name: "Video" });
    await user.click(screen.getByRole("button", { name: "Tabella" }));
    const table = screen.getByRole("table", { name: "Video" });
    const film = within(table).getByRole("row", { name: /Film/ });
    expect(film).toHaveTextContent("Nascosto");
    expect(film).toHaveTextContent("Copia per tutti i browser");
    expect(film).toHaveTextContent("MP4 · h264 · aac");
    expect(within(film).queryAllByRole("button")).toEqual([]);
    expect(within(film).getByRole("link", { name: "Modifica Film" })).toHaveAttribute(
      "href",
      "/admin/video/8",
    );
    unmount();

    renderApp("/admin/video", routes);
    expect(await screen.findByRole("table", { name: "Video" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tabella" })).toHaveAttribute("aria-pressed", "true");
  });

  it("searches and filters, also the public ones", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(screen.getByRole("button", { name: "Pubblici" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("show=public"));
    await user.click(screen.getByRole("button", { name: "Nascosti" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("show=hidden"));
    await user.type(screen.getByRole("searchbox", { name: "Cerca tra i video" }), "mare{Enter}");
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("q=mare"));
    expect(server.requests.at(-1)?.url).toContain("show=hidden");
  });

  it("follows the library as it changes", async () => {
    stubEventSource();
    let videos = [adminVideo()];
    renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": () => new Response(JSON.stringify({ videos, total: videos.length })),
    });
    await screen.findByRole("list", { name: "Video" });
    videos = [adminVideo({ id: 10, title: "Nuovo" }), ...videos];
    act(() => FakeEventSource.last?.emit("library"));
    expect(await screen.findByText("Nuovo")).toBeInTheDocument();
  });

  it("opens the page of a video from its row", async () => {
    const { user } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
      "GET /api/admin/videos/7": { body: adminVideo() },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("link", { name: "Modifica Mare 2024" }));
    // The page loads its code the first time: give it a moment.
    expect(
      await screen.findByRole("heading", { level: 2, name: "Mare 2024" }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Video", current: false })).toHaveAttribute(
      "href",
      "/admin/video",
    );
  });
});

// detail renders the page of one video.
async function detail(video = adminVideo(), routes: Record<string, unknown> = {}) {
  const app = renderApp("/admin/video/7", {
    ...signedIn(),
    "GET /api/admin/videos/7": { body: video },
    ...routes,
  });
  await screen.findByRole("heading", { level: 2, name: video.title as string }, { timeout: 3000 });
  return app;
}

function section(name: string) {
  return screen.getByRole("region", { name });
}

describe("page of a video in the administration", () => {
  it("has every section, each reachable from the list of sections", async () => {
    await detail();
    const nav = screen.getByRole("navigation", { name: "Sezioni del video" });
    for (const name of [
      "Informazioni",
      "Copertina e anteprima",
      "Visibilità e condivisione",
      "Formato",
    ]) {
      expect(section(name)).toBeInTheDocument();
      const link = within(nav).getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(`#${section(name).id}`);
    }
    expect(section("Formato")).toHaveTextContent("Va su tutti i browser");
  });

  it("changes the title and category of a video", async () => {
    const { user, server } = await detail(adminVideo(), {
      "GET /api/categories": { body: [{ name: "Viaggi", videos: 3, color: "", image: null }] },
      "PUT /api/admin/videos/7/details": { status: 204 },
    });
    await user.click(screen.getByRole("button", { name: "Modifica titolo e categoria" }));
    await vi.waitFor(() =>
      expect(document.querySelector('#admin-categories option[value="Viaggi"]')).not.toBeNull(),
    );
    const form = screen.getByRole("form", { name: "Modifica Mare 2024" });
    const title = within(form).getByRole("textbox", { name: /Titolo/ });
    await user.clear(title);
    await user.type(title, "Al mare con la nonna");
    expect(within(form).getByText(/Trovato da FranzPLAY: «Mare 2024»/)).toBeInTheDocument();
    const category = within(form).getByRole("combobox", { name: /Categoria/ });
    await user.clear(category);
    await user.type(category, "Viaggi");
    await user.click(within(form).getByRole("button", { name: "Salva" }));
    expect(await within(section("Informazioni")).findByRole("status")).toHaveTextContent(
      "Salvato.",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Al mare con la nonna" }),
    ).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({
      title: "Al mare con la nonna",
      category: "Viaggi",
    });
  });

  it("puts back the title and category FranzPLAY found", async () => {
    const { user, server } = await detail(
      adminVideo({ title: "Al mare", category: "", titleSet: true, categorySet: true }),
      { "PUT /api/admin/videos/7/details": { status: 204 } },
    );
    await user.click(screen.getByRole("button", { name: "Modifica titolo e categoria" }));
    const form = screen.getByRole("form", { name: "Modifica Al mare" });
    await user.click(within(form).getByRole("button", { name: "Rimetti questo" }));
    await user.click(within(form).getByRole("button", { name: "Rimetti questa" }));
    await user.click(within(form).getByRole("button", { name: "Salva" }));
    expect(await within(section("Informazioni")).findByRole("status")).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({ title: null, category: null });
  });

  it("refuses an empty title", async () => {
    const { user, server } = await detail();
    await user.click(screen.getByRole("button", { name: "Modifica titolo e categoria" }));
    const form = screen.getByRole("form", { name: "Modifica Mare 2024" });
    await user.clear(within(form).getByRole("textbox", { name: /Titolo/ }));
    await user.click(within(form).getByRole("button", { name: "Salva" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Il titolo deve avere");
    expect(server.requests.some((r) => r.url.includes("/details"))).toBe(false);
  });

  it("hides a video and shows it again", async () => {
    const { user, server } = await detail(adminVideo(), {
      "PUT /api/admin/videos/7/hidden": { status: 204 },
    });
    const box = section("Visibilità e condivisione");
    await user.click(within(box).getByRole("button", { name: "Nascondi" }));
    expect(await within(box).findByRole("status")).toHaveTextContent("Nascosto a tutti.");
    expect(await server.requests.at(-1)?.json()).toEqual({ hidden: true });
    await user.click(within(box).getByRole("button", { name: "Mostra" }));
    expect(await within(box).findByRole("status")).toHaveTextContent("Di nuovo visibile a tutti.");
    expect(await server.requests.at(-1)?.json()).toEqual({ hidden: false });
  });

  it("says when an action fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = await detail(adminVideo(), {
      "PUT /api/admin/videos/7/hidden": { status: 500, body: { error: "internal error" } },
    });
    const box = section("Visibilità e condivisione");
    await user.click(within(box).getByRole("button", { name: "Nascondi" }));
    expect(await within(box).findByRole("alert")).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Nascondi" })).toBeInTheDocument();
  });

  it("has the cover made again, but not for a file not found", async () => {
    const { user, server } = await detail(adminVideo(), {
      "POST /api/admin/videos/7/refresh": { status: 204 },
    });
    const box = section("Copertina e anteprima");
    await user.click(within(box).getByRole("button", { name: "Rifai copertina e anteprime" }));
    expect(await within(box).findByRole("status")).toHaveTextContent("In coda");
    expect(server.requests.at(-1)?.method).toBe("POST");
  });

  it("keeps the actions on the file closed when the file is not found", async () => {
    await detail(adminVideo({ missing: true }));
    const box = section("Copertina e anteprima");
    for (const name of ["Cambia copertina", "Cambia anteprima", "Rifai copertina e anteprime"]) {
      expect(within(box).getByRole("button", { name })).toBeDisabled();
    }
  });

  it("manages the public link without asking for it again", async () => {
    const key = "abcdefghijklmnopqrstuv";
    const { user, server } = await detail(adminVideo(), {
      "POST /api/videos/7/public-link": {
        body: { link: `/p/${key}`, createdAt: "2026-10-15T10:00:00Z" },
      },
      "DELETE /api/videos/7/public-link": { status: 204 },
    });
    const box = section("Visibilità e condivisione");
    expect(within(box).getByText("Non pubblico")).toBeInTheDocument();
    await user.click(within(box).getByRole("button", { name: "Crea link pubblico" }));
    expect(await within(box).findByRole("textbox", { name: "Link del video" })).toHaveValue(
      `${window.location.origin}/p/${key}`,
    );
    expect(within(box).getByText("Pubblico")).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Copia link" })).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Rinnova link" })).toBeInTheDocument();
    await user.click(within(box).getByRole("button", { name: "Disattiva link" }));
    await waitFor(() => expect(within(box).getByText("Non pubblico")).toBeInTheDocument());
    expect(
      server.requests.filter((r) => r.method === "GET" && r.url.includes("public-link")),
    ).toEqual([]);
  });

  it("says when the video is not there", async () => {
    renderApp("/admin/video/99", signedIn());
    expect(await screen.findByRole("heading", { name: "Video non trovato" })).toBeInTheDocument();
  });
});
