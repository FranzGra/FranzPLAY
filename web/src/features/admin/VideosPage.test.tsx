import { act, screen, within } from "@testing-library/react";
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
    const list = await screen.findByRole("list", { name: "Video" });
    const row = within(list).getByRole("listitem");
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
    await user.click(screen.getByRole("button", { name: "Filtro: Tutti" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Pubblici/ }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("show=public"));
    await user.click(screen.getByRole("button", { name: "Filtro: Pubblici" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Nascosti/ }));
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

  it("filters from a menu with how many each shows, by keyboard too", async () => {
    const { user } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [adminVideo()],
          total: 9,
          counts: { "": 9, public: 2, hidden: 1, missing: 0, short: 3 },
        },
      },
    });
    await screen.findByRole("list", { name: "Video" });
    expect(screen.getByText("9 video")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Filtro: Tutti" });
    await user.click(button);
    const menu = screen.getByRole("menu", { name: "Quali video" });
    expect(within(menu).getByRole("menuitemradio", { name: /Tutti/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(menu).getByRole("menuitemradio", { name: /Pubblici/ })).toHaveTextContent("2");
    expect(within(menu).getByRole("menuitemradio", { name: /Tutti/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitemradio", { name: /Pubblici/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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
  await screen.findByRole("textbox", { name: "Titolo" }, { timeout: 3000 });
  return app;
}

function group(name: string) {
  return screen.getByRole("region", { name });
}

describe("page of a video in the administration", () => {
  it("shows the video and its file, and every group of the form", async () => {
    const { user } = await detail();
    expect(screen.getByRole("list", { name: "Il file" })).toHaveTextContent("4:05");
    expect(screen.getByRole("list", { name: "Il file" })).toHaveTextContent("1080p");
    expect(screen.getByText("/media/video/Vacanze/Mare 2024.mp4")).toBeInTheDocument();
    for (const name of ["Chi lo vede", "Copertina", "Formato"]) {
      expect(group(name)).toBeInTheDocument();
    }
    expect(
      within(group("Chi lo vede")).getByRole("radio", { name: /Tutti con account/ }),
    ).toBeChecked();
    // No list of sections beside the form.
    expect(screen.queryByRole("navigation", { name: "Sezioni del video" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guarda Mare 2024" }));
    expect(document.querySelector("video")).toHaveAttribute("src", "/api/videos/7/stream");
  });

  it("goes to the video before and after in the list", async () => {
    renderApp({ pathname: "/admin/video/7", state: { ids: [5, 7, 9] } } as never, {
      ...signedIn(),
      "GET /api/admin/videos/7": { body: adminVideo() },
    });
    await screen.findByRole("textbox", { name: "Titolo" }, { timeout: 3000 });
    expect(screen.getByRole("link", { name: "Video precedente" })).toHaveAttribute(
      "href",
      "/admin/video/5",
    );
    expect(screen.getByRole("link", { name: "Video successivo" })).toHaveAttribute(
      "href",
      "/admin/video/9",
    );
    expect(screen.getByText("2 di 3")).toBeInTheDocument();
  });

  it("changes the title and category in place, saving only on Salva", async () => {
    const { user, server } = await detail(adminVideo(), {
      "GET /api/categories": { body: [{ name: "Viaggi", videos: 3, color: "", image: null }] },
      "PUT /api/admin/videos/7/details": { status: 204 },
    });
    expect(screen.queryByText("Modifiche non salvate")).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(document.querySelector('#admin-categories option[value="Viaggi"]')).not.toBeNull(),
    );
    const title = screen.getByRole("textbox", { name: "Titolo" });
    await user.clear(title);
    await user.type(title, "Al mare con la nonna");
    expect(screen.getByText(/Nome del file: «Mare 2024»/)).toBeInTheDocument();
    const category = screen.getByRole("combobox", { name: "Categoria" });
    await user.clear(category);
    await user.type(category, "Viaggi");
    expect(screen.getByText("Modifiche non salvate")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salva" }));
    expect(await screen.findByText("Salvato")).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({
      title: "Al mare con la nonna",
      category: "Viaggi",
    });
  });

  it("undoes the changes not saved", async () => {
    const { user, server } = await detail();
    const title = screen.getByRole("textbox", { name: "Titolo" });
    await user.type(title, " bis");
    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(title).toHaveValue("Mare 2024");
    expect(screen.queryByText("Modifiche non salvate")).not.toBeInTheDocument();
    expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("puts back the title and category FranzPLAY found", async () => {
    const { user, server } = await detail(
      adminVideo({ title: "Al mare", category: "", titleSet: true, categorySet: true }),
      { "PUT /api/admin/videos/7/details": { status: 204 } },
    );
    await user.click(screen.getByRole("button", { name: "Usa questo" }));
    await user.click(screen.getByRole("button", { name: "Usa questa" }));
    await user.click(screen.getByRole("button", { name: "Salva" }));
    expect(await screen.findByText("Salvato")).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({ title: null, category: null });
  });

  it("refuses an empty title", async () => {
    const { user, server } = await detail();
    await user.clear(screen.getByRole("textbox", { name: "Titolo" }));
    await user.click(screen.getByRole("button", { name: "Salva" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Il titolo deve avere");
    expect(server.requests.some((r) => r.url.includes("/details"))).toBe(false);
  });

  it("hides a video with a switch, and shows it again", async () => {
    const { user, server } = await detail(adminVideo(), {
      "PUT /api/admin/videos/7/hidden": { status: 204 },
    });
    const hidden = screen.getByRole("switch", { name: /Nascosto/ });
    await user.click(hidden);
    expect(await screen.findByRole("status")).toHaveTextContent("Nascosto a tutti.");
    expect(await server.requests.at(-1)?.json()).toEqual({ hidden: true });
    await vi.waitFor(() => expect(hidden).toBeChecked());
    await user.click(hidden);
    await vi.waitFor(async () =>
      expect(await server.requests.at(-1)?.clone().json()).toEqual({ hidden: false }),
    );
  });

  it("says when an action fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = await detail(adminVideo(), {
      "PUT /api/admin/videos/7/hidden": { status: 500, body: { error: "internal error" } },
    });
    await user.click(screen.getByRole("switch", { name: /Nascosto/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Non ci sono riuscito");
    expect(screen.getByRole("switch", { name: /Nascosto/ })).not.toBeChecked();
  });

  it("chooses a moment of the video as cover, and remakes it", async () => {
    const { user, server } = await detail(
      adminVideo({
        preview: {
          src: "/api/previews/7-abc.jpg",
          gap: 10,
          count: 24,
          columns: 6,
          width: 160,
          height: 90,
        },
      }),
      {
        "PUT /api/admin/videos/7/cover-second": { status: 204 },
        "POST /api/admin/videos/7/refresh": { status: 204 },
      },
    );
    const covers = screen.getByRole("group", { name: "Scegli la copertina" });
    expect(within(covers).getByRole("radio", { name: "Quella scelta da FranzPLAY" })).toBeChecked();
    const moments = within(covers).getAllByRole("radio", { name: /Il momento/ });
    expect(moments.length).toBeGreaterThan(3);
    await user.click(moments[0] as HTMLElement);
    expect(await screen.findByRole("status")).toHaveTextContent("la nuova copertina arriva");
    expect(await server.requests.at(-1)?.json()).toEqual({ second: 20 });
    expect(moments[0]).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Rigenera" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("/refresh"));
  });

  it("keeps the actions on the file closed when the file is not found", async () => {
    await detail(adminVideo({ missing: true }));
    for (const name of ["Carica immagine o cerca", "Cambia anteprima", "Rigenera"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.queryByRole("switch", { name: /Link pubblico/ })).not.toBeInTheDocument();
  });

  it("turns the public link on, copies it, and off after asking", async () => {
    const key = "abcdefghijklmnopqrstuv";
    const { user, server } = await detail(adminVideo(), {
      "POST /api/videos/7/public-link": {
        body: { link: `/p/${key}`, createdAt: "2026-10-15T10:00:00Z" },
      },
      "DELETE /api/videos/7/public-link": { status: 204 },
    });
    // jsdom has no clipboard: the old way of copying says yes.
    Object.defineProperty(document, "execCommand", { value: () => true, configurable: true });
    const box = group("Chi lo vede");
    const on = within(box).getByRole("switch", { name: /Link pubblico/ });
    expect(on).not.toBeChecked();
    await user.click(on);
    expect(await within(box).findByRole("textbox", { name: "Link pubblico" })).toHaveValue(
      `${window.location.origin}/p/${key}`,
    );
    await user.click(within(box).getByRole("button", { name: "Copia link" }));
    expect(await within(box).findByRole("button", { name: "Copiato" })).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Genera nuovo link" })).toBeInTheDocument();
    await user.click(within(box).getByRole("switch", { name: /Link pubblico/ }));
    const ask = within(box).getByRole("alertdialog", { name: "Disattivare il link?" });
    await user.click(within(ask).getByRole("button", { name: "Disattiva" }));
    await vi.waitFor(() =>
      expect(within(box).getByRole("switch", { name: /Link pubblico/ })).not.toBeChecked(),
    );
    expect(server.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
    expect(
      server.requests.filter((r) => r.method === "GET" && r.url.includes("public-link")),
    ).toEqual([]);
  });

  it("offers a copy for every browser when the file needs one", async () => {
    const { user, server } = await detail(adminVideo({ playable: false }), {
      "POST /api/videos/7/prepare": { body: { state: "waiting" } },
    });
    expect(group("Formato")).toHaveTextContent("Non va su tutti i browser");
    await user.click(screen.getByRole("button", { name: "Crea copia compatibile" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("/prepare"));
  });

  it("says when the video is not there", async () => {
    renderApp("/admin/video/99", signedIn());
    expect(
      await screen.findByRole("heading", { name: "Video non trovato" }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});
