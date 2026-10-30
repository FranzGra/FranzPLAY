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
  const table = screen.getByRole("table", { name: "Video" });
  const row = within(table)
    .getAllByRole("row")
    .find((tr) => within(tr).queryByRole("link", { name }));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("videos page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows every video in a table, with one state and one action", async () => {
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
          counts: { "": 3, public: 1, hidden: 1, missing: 1, short: 0 },
        },
      },
    });
    await screen.findByRole("table", { name: "Video" });
    const sea = rowOf("Mare 2024");
    // Under the title only the name of the file: the whole path is long.
    expect(within(sea).getByText("Mare 2024.mp4")).toHaveAttribute(
      "title",
      "Vacanze/Mare 2024.mp4",
    );
    expect(sea).not.toHaveTextContent("Vacanze/Mare 2024.mp4");
    expect(sea).toHaveTextContent("4:05");
    expect(sea).toHaveTextContent("Pronto");
    expect(within(sea).getAllByRole("button")).toHaveLength(1);
    expect(within(sea).getByRole("link", { name: "Modifica Mare 2024" })).toHaveAttribute(
      "href",
      "/admin/video/7",
    );
    expect(rowOf("Segreto")).toHaveTextContent("Nascosto");
    expect(rowOf("Perso")).toHaveTextContent("File non trovato");
    expect(rowOf("Perso")).toHaveTextContent("—");
    expect(screen.getByText(/^3 video dalle cartelle/)).toBeInTheDocument();
  });

  it("on a phone shows each video as a card, its title and picture open its page", async () => {
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
    expect(within(list).getByRole("link", { name: "Al mare" })).toHaveAttribute(
      "href",
      "/admin/video/7",
    );
    expect(within(list).getByRole("link", { name: "Copertina di Al mare" })).toHaveAttribute(
      "href",
      "/admin/video/7",
    );
    expect(within(list).getByRole("listitem")).toHaveTextContent("Privato");
  });

  it("shows what FranzPLAY is doing on a video in its row", async () => {
    renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
      "GET /api/jobs": {
        body: {
          waiting: 0,
          retrying: 0,
          done: 3,
          running: {
            id: 4,
            kind: "cover",
            videoId: 7,
            title: "Mare 2024",
            attempts: 0,
            error: "",
            at: "2026-10-12T10:00:00Z",
          },
          failed: [],
          failedTotal: 0,
          kinds: [{ kind: "cover", available: true }],
        },
      },
    });
    await screen.findByRole("table", { name: "Video" });
    await vi.waitFor(() => expect(rowOf("Mare 2024")).toHaveTextContent("Copertina in corso"));
    expect(rowOf("Mare 2024")).toHaveAttribute("data-working", "true");
  });

  it("searches and filters, with how many each shows", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [adminVideo()],
          total: 9,
          counts: { "": 9, public: 2, hidden: 1, missing: 0, short: 3 },
        },
      },
    });
    await screen.findByRole("table", { name: "Video" });
    const filters = screen.getByRole("group", { name: "Mostra" });
    expect(within(filters).getByRole("button", { name: /Tutti/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const pub = within(filters).getByRole("button", { name: /Con link pubblico/ });
    expect(pub).toHaveTextContent("2");
    await user.click(pub);
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("show=public"));
    expect(pub).toHaveAttribute("aria-pressed", "true");
    await user.click(within(filters).getByRole("button", { name: /Nascosti/ }));
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
    await screen.findByRole("table", { name: "Video" });
    videos = [adminVideo({ id: 10, title: "Nuovo" }), ...videos];
    act(() => FakeEventSource.last?.emit("library"));
    const table = screen.getByRole("table", { name: "Video" });
    expect(await within(table).findByRole("link", { name: "Modifica Nuovo" })).toBeInTheDocument();
  });

  describe("preview of a video", () => {
    const two = {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: { videos: [adminVideo(), adminVideo({ id: 8, title: "Film" })], total: 2 },
      },
      "GET /api/admin/videos/7": { body: adminVideo() },
      "PUT /api/admin/videos/8/hidden": { status: 204 },
    };
    const panelOf = (name: string) => screen.queryByRole("complementary", { name });
    const anyPanel = () => screen.queryByRole("complementary", { name: /^Dettagli di/ });
    const open = async () => {
      const app = renderApp("/admin/video", two);
      await screen.findByRole("table", { name: "Video" });
      return app;
    };

    it("is closed at first, opens with a click on the row and acts on that video", async () => {
      const { user, server } = await open();
      expect(anyPanel()).not.toBeInTheDocument();
      await user.click(within(rowOf("Film")).getByText("Mare 2024.mp4"));
      const panel = screen.getByRole("complementary", { name: "Dettagli di Film" });
      expect(rowOf("Film")).toHaveAttribute("data-selected", "true");
      expect(within(panel).getByRole("link", { name: "Modifica" })).toHaveAttribute(
        "href",
        "/admin/video/8",
      );
      await user.click(within(panel).getByRole("button", { name: "Nascondi" }));
      expect(await screen.findByText("Video nascosto a tutti.")).toBeInTheDocument();
      expect(server.requests.some((r) => r.url.includes("/videos/8/hidden"))).toBe(true);
    });

    it("closes with another click on the same row, moves with a click on another", async () => {
      const { user } = await open();
      await user.click(within(rowOf("Film")).getByText("Mare 2024.mp4"));
      expect(panelOf("Dettagli di Film")).toBeInTheDocument();
      await user.click(within(rowOf("Film")).getByText("Mare 2024.mp4"));
      expect(anyPanel()).not.toBeInTheDocument();
      expect(rowOf("Film")).not.toHaveAttribute("data-selected");
      await user.click(within(rowOf("Film")).getByText("Mare 2024.mp4"));
      await user.click(within(rowOf("Mare 2024")).getByText("Mare 2024.mp4"));
      expect(panelOf("Dettagli di Mare 2024")).toBeInTheDocument();
      expect(panelOf("Dettagli di Film")).not.toBeInTheDocument();
    });

    it("the title goes to the page of the video, without opening the preview", async () => {
      const { user } = await open();
      await user.click(within(rowOf("Mare 2024")).getByRole("link", { name: "Mare 2024" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Mare 2024" }, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Titolo" })).toBeInTheDocument();
      expect(anyPanel()).not.toBeInTheDocument();
    });

    it("the picture goes to the page of the video, without opening the preview", async () => {
      const { user } = await open();
      await user.click(
        within(rowOf("Mare 2024")).getByRole("link", { name: "Copertina di Mare 2024" }),
      );
      expect(
        await screen.findByRole("heading", { level: 1, name: "Mare 2024" }, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(anyPanel()).not.toBeInTheDocument();
    });

    it("works from the keyboard: the button of the row, then Esc", async () => {
      const { user } = await open();
      const button = within(rowOf("Film")).getByRole("button", { name: "Anteprima di Film" });
      expect(button).toHaveAttribute("aria-expanded", "false");
      button.focus();
      await user.keyboard("{Enter}");
      expect(panelOf("Dettagli di Film")).toBeInTheDocument();
      expect(button).toHaveAttribute("aria-expanded", "true");
      await user.keyboard("{Escape}");
      expect(anyPanel()).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });

    it("leaves Esc to the search box", async () => {
      const { user } = await open();
      await user.click(within(rowOf("Film")).getByText("Mare 2024.mp4"));
      await user.click(screen.getByRole("searchbox", { name: "Cerca tra i video" }));
      await user.keyboard("{Escape}");
      expect(panelOf("Dettagli di Film")).toBeInTheDocument();
    });

    it("closes with its X", async () => {
      const { user } = await open();
      await user.click(within(rowOf("Film")).getByText("Mare 2024.mp4"));
      const panel = screen.getByRole("complementary", { name: "Dettagli di Film" });
      await user.click(within(panel).getByRole("button", { name: "Chiudi anteprima" }));
      expect(anyPanel()).not.toBeInTheDocument();
    });

    it("with little room opens under the card, and closes the same way", async () => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width: 343,
        top: 0,
      } as DOMRect);
      window.scrollBy = () => {};
      const { user } = await open();
      const list = screen.getByRole("list", { name: "Video" });
      const card = within(list).getByRole("link", { name: "Film" }).closest("li") as HTMLElement;
      await user.click(within(card).getByText("Vacanze · 1080p"));
      expect(within(card).getByRole("complementary", { name: "Dettagli di Film" })).toBeVisible();
      await user.click(within(card).getByText("Vacanze · 1080p"));
      expect(anyPanel()).not.toBeInTheDocument();
      await user.click(within(card).getByRole("link", { name: "Copertina di Film" }));
      expect(anyPanel()).not.toBeInTheDocument();
    });
  });

  it("opens the page of a video from its row", async () => {
    const { user } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
      "GET /api/admin/videos/7": { body: adminVideo() },
    });
    await screen.findByRole("table", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("link", { name: "Modifica Mare 2024" }));
    // The page loads its code the first time: give it a moment.
    expect(
      await screen.findByRole("heading", { level: 1, name: "Mare 2024" }, { timeout: 3000 }),
    ).toBeInTheDocument();
    // The path on top goes back to the list.
    const crumb = screen.getByRole("list", { name: "Sei qui" });
    expect(within(crumb).getByRole("link", { name: "Video" })).toHaveAttribute(
      "href",
      "/admin/video",
    );
    expect(within(crumb).getByText("Mare 2024")).toHaveAttribute("aria-current", "page");
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
  it("shows the video and every section, each with its icon", async () => {
    const { user } = await detail();
    expect(screen.getByRole("heading", { level: 1, name: "Mare 2024" })).toBeInTheDocument();
    for (const name of [
      "Dettagli",
      "Copertina",
      "Anteprima sulla scheda",
      "Chi lo vede",
      "Lavori su questo video",
      "Il file",
    ]) {
      const heading = within(group(name)).getByRole("heading", { level: 2, name });
      expect(heading.querySelector("svg")).not.toBeNull();
    }
    expect(group("Il file")).toHaveTextContent("/media/video/Vacanze/Mare 2024.mp4");
    expect(group("Il file")).toHaveTextContent("4:05");
    expect(
      within(group("Chi lo vede")).getByRole("radio", { name: /Tutti con account/ }),
    ).toBeChecked();
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

  it("changes the title from the pencil on top, saving only on Salva", async () => {
    const { user, server } = await detail(adminVideo(), {
      "GET /api/categories": { body: [{ name: "Viaggi", videos: 3, color: "", image: null }] },
      "PUT /api/admin/videos/7/details": { status: 204 },
    });
    expect(screen.queryByRole("button", { name: "Salva modifiche" })).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(document.querySelector('datalist option[value="Viaggi"]')).not.toBeNull(),
    );
    await user.click(screen.getByRole("button", { name: "Cambia titolo" }));
    const title = screen.getByRole("textbox", { name: "Titolo" });
    expect(title).toHaveFocus();
    await user.clear(title);
    await user.type(title, "Al mare con la nonna");
    expect(screen.getByText(/Dal nome del file: «Mare 2024»/)).toBeInTheDocument();
    expect(screen.getByText("Titolo cambiato, non salvato")).toBeInTheDocument();
    const category = screen.getByRole("combobox", { name: "Categoria" });
    await user.clear(category);
    await user.type(category, "Viaggi");
    expect(screen.getByText("Titolo e categoria cambiati, non salvati")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salva modifiche" }));
    expect(await screen.findByText("Modifiche salvate.")).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({
      title: "Al mare con la nonna",
      category: "Viaggi",
    });
    expect(screen.getByRole("heading", { level: 1, name: "Al mare con la nonna" })).toBeVisible();
  });

  it("undoes the changes not saved", async () => {
    const { user, server } = await detail();
    const title = screen.getByRole("textbox", { name: "Titolo" });
    await user.type(title, " bis");
    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(title).toHaveValue("Mare 2024");
    expect(screen.queryByRole("button", { name: "Salva modifiche" })).not.toBeInTheDocument();
    expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("puts back the title and category FranzPLAY found", async () => {
    const { user, server } = await detail(
      adminVideo({ title: "Al mare", category: "", titleSet: true, categorySet: true }),
      { "PUT /api/admin/videos/7/details": { status: 204 } },
    );
    await user.click(screen.getByRole("button", { name: "Usa questo" }));
    await user.click(screen.getByRole("button", { name: "Usa questa" }));
    await user.click(screen.getByRole("button", { name: "Salva modifiche" }));
    expect(await screen.findByText("Modifiche salvate.")).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({ title: null, category: null });
  });

  it("refuses an empty title", async () => {
    const { user, server } = await detail();
    await user.clear(screen.getByRole("textbox", { name: "Titolo" }));
    await user.click(screen.getByRole("button", { name: "Salva modifiche" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Il titolo deve avere");
    expect(server.requests.some((r) => r.url.includes("/details"))).toBe(false);
  });

  it("hides a video with a switch, and shows it again", async () => {
    const { user, server } = await detail(adminVideo(), {
      "PUT /api/admin/videos/7/hidden": { status: 204 },
    });
    const hidden = screen.getByRole("switch", { name: "Nascosto" });
    await user.click(hidden);
    expect(await screen.findByText("Nascosto a tutti.")).toBeInTheDocument();
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
    await user.click(screen.getByRole("switch", { name: "Nascosto" }));
    expect(await screen.findByText("Non ci sono riuscito. Riprova tra poco.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Nascosto" })).not.toBeChecked();
  });

  it("keeps the actions on the file closed when the file is not found", async () => {
    await detail(adminVideo({ missing: true }));
    expect(screen.getByRole("button", { name: "Rileggi il video" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rifalla dal video" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Nascosto" })).toBeDisabled();
    expect(screen.queryByRole("switch", { name: "Link pubblico" })).not.toBeInTheDocument();
    expect(screen.getByText("File non trovato")).toBeInTheDocument();
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
    const on = within(box).getByRole("switch", { name: "Link pubblico" });
    expect(on).not.toBeChecked();
    await user.click(on);
    expect(await within(box).findByRole("textbox", { name: "Link pubblico" })).toHaveValue(
      `${window.location.origin}/p/${key}`,
    );
    await user.click(within(box).getByRole("button", { name: "Copia link" }));
    expect(await within(box).findByRole("button", { name: "Copiato" })).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Genera nuovo link" })).toBeInTheDocument();
    await user.click(within(box).getByRole("switch", { name: "Link pubblico" }));
    const ask = within(box).getByRole("alertdialog", { name: "Disattivare il link?" });
    await user.click(within(ask).getByRole("button", { name: "Disattiva" }));
    await vi.waitFor(() =>
      expect(within(box).getByRole("switch", { name: "Link pubblico" })).not.toBeChecked(),
    );
    expect(server.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });

  it("offers a copy for every browser when the file needs one", async () => {
    const { user, server } = await detail(adminVideo({ playable: false }), {
      "POST /api/videos/7/prepare": { body: { state: "waiting" } },
    });
    await user.click(screen.getByRole("button", { name: "Crea copia compatibile" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("/prepare"));
    expect(screen.getByRole("button", { name: "Copia in preparazione" })).toBeDisabled();
  });

  it("remakes cover and previews from the work on the video", async () => {
    const { user, server } = await detail(adminVideo(), {
      "POST /api/admin/videos/7/refresh": { status: 204 },
    });
    expect(group("Lavori su questo video")).toHaveTextContent("Nessun lavoro in corso");
    await user.click(screen.getByRole("button", { name: "Rileggi il video" }));
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.url.includes("/refresh"))).toBe(true),
    );
    expect(await screen.findByText(/In coda: FranzPLAY rilegge il video/)).toBeInTheDocument();
  });

  it("says when the video is not there", async () => {
    renderApp("/admin/video/99", signedIn());
    expect(
      await screen.findByRole("heading", { name: "Video non trovato" }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});
