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
          counts: { "": 9, eligible: 5, problems: 1, public: 2, hidden: 1, missing: 0, short: 3 },
        },
      },
    });
    await screen.findByRole("table", { name: "Video" });
    const filters = screen.getByRole("group", { name: "Mostra" });
    expect(within(filters).getByRole("button", { name: /Idonei/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(server.requests.some((r) => r.url.includes("show=eligible"))).toBe(true);
    expect(within(filters).getByRole("button", { name: /Scartati/ })).toHaveTextContent("3");
    expect(within(filters).getByRole("button", { name: /Con problemi/ })).toHaveTextContent("1");
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

  it("asks the server for what each pill says", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: { videos: [adminVideo()], total: 1, counts: { "": 1, eligible: 1 }, minDuration: 90 },
      },
    });
    await screen.findByRole("table", { name: "Video" });
    const filters = screen.getByRole("group", { name: "Mostra" });
    const pressed = (name: RegExp) =>
      within(filters).getByRole("button", { name }).getAttribute("aria-pressed");

    await user.click(within(filters).getByRole("button", { name: /Scartati/ }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("show=short"));
    expect(
      await screen.findByText(/Durano meno del minimo scelto dall'amministratore, 90 secondi/),
    ).toBeVisible();
    await user.click(within(filters).getByRole("button", { name: /Con problemi/ }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("show=problems"));
    expect(pressed(/Con problemi/)).toBe("true");
  });

  it("asks for every video only on the pill that says so", async () => {
    const { server } = renderApp("/admin/video?show=all", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
    });
    await screen.findByRole("table", { name: "Video" });
    const list = server.requests.filter((r) => r.url.includes("/api/admin/videos"));
    expect(list.at(-1)?.url).not.toContain("show=");
    expect(
      within(screen.getByRole("group", { name: "Mostra" })).getByRole("button", { name: /Tutti/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("marks a file that cannot be read", async () => {
    renderApp("/admin/video?show=problems", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [adminVideo({ fileProblem: "damaged", duration: null })],
          total: 1,
          counts: { problems: 1 },
        },
      },
    });
    await screen.findByRole("table", { name: "Video" });
    expect(rowOf("Mare 2024")).toHaveTextContent("File illeggibile");
    expect(screen.getByText(/FranzPLAY non riesce a leggerli/)).toBeVisible();
  });

  it("says when a pill is empty, and goes back to the eligible videos", async () => {
    const { user, server } = renderApp("/admin/video?show=problems", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [], total: 0 } },
    });
    expect(await screen.findByRole("heading", { name: "Nessun file con problemi" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Torna ai video idonei" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("show=eligible"));
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

// quietQueue is the queue of a server with nothing going on.
const quietQueue = {
  waiting: 0,
  retrying: 0,
  done: 0,
  running: null,
  failed: [],
  failedTotal: 0,
  kinds: [],
};

describe("page of a video in the administration", () => {
  it("gives priority to the jobs waiting on the video, only when there are some", async () => {
    const waiting = {
      id: 31,
      kind: "cover",
      videoId: 7,
      title: "Mare",
      attempts: 0,
      error: "",
      at: "2026-10-12T10:00:00Z",
      state: "pending",
      urgent: false,
    };
    let queue = [waiting];
    const { user, server } = await detail(adminVideo(), {
      "GET /api/jobs": { body: quietQueue },
      "GET /api/jobs/video/7": () => Response.json({ queue }),
      "PUT /api/jobs/video/7/priority": () => {
        queue = [{ ...waiting, urgent: true }];
        return Response.json({ count: 1 });
      },
    });
    const give = await screen.findByRole("button", { name: "Dai la priorità" });
    await user.click(give);
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.method === "PUT" && r.url.includes("/priority"))).toBe(
        true,
      ),
    );
    expect(
      await screen.findByText("I lavori di questo video sono in cima alla coda."),
    ).toBeVisible();
    expect(await screen.findByRole("button", { name: "Togli priorità" })).toBeEnabled();
  });

  it("shows no priority button when no job waits on the video", async () => {
    const { server } = await detail(adminVideo(), {
      "GET /api/jobs": { body: quietQueue },
      "GET /api/jobs/video/7": { body: { queue: [] } },
    });
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.url.includes("/api/jobs/video/7"))).toBe(true),
    );
    expect(screen.queryByRole("button", { name: "Dai la priorità" })).not.toBeInTheDocument();
  });

  it.each([
    [{ missing: true }, "Il file non c'è più", /Se l'hai solo spostato/],
    [{ fileProblem: "damaged", duration: null }, "File illeggibile", /rovinato o incompleto/],
    [{ fileProblem: "no_video", duration: null }, "File illeggibile", /non contiene immagini/],
    [{ hidden: true }, "Video nascosto", /rendilo di nuovo visibile/],
    [
      { tooShort: true, duration: 12, minDuration: 90 },
      "Troppo corto",
      /Dura 0:12: il minimo scelto per le cartelle è 1:30/,
    ],
    [{ private: true }, "Video privato", /Chi lo vede/],
    [{ duration: null }, "Non ancora letto", /sta ancora leggendo/],
  ])("says why there is no play button: %o", async (change, title, why) => {
    const { server } = await detail(adminVideo(change), { "GET /api/jobs": { body: quietQueue } });
    expect(server.requests.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Guarda / })).not.toBeInTheDocument();
    const box = screen.getByText(title, { selector: "p" });
    expect(box.parentElement).toHaveTextContent(why);
  });

  it("asks for a compatible copy from the box of a format browsers cannot open", async () => {
    const { user, server } = await detail(adminVideo({ playable: false, videoCodec: "hevc" }), {
      "GET /api/jobs": { body: quietQueue },
      "POST /api/videos/7/prepare": { body: { state: "waiting" } },
    });
    expect(screen.queryByRole("button", { name: /^Guarda / })).not.toBeInTheDocument();
    const box = screen.getByText("Formato non diretto").parentElement as HTMLElement;
    await user.click(within(box).getByRole("button", { name: "Crea copia compatibile" }));
    await vi.waitFor(() =>
      expect(
        server.requests.some((r) => r.method === "POST" && r.url.endsWith("/api/videos/7/prepare")),
      ).toBe(true),
    );
  });

  it("keeps the play button when nothing stops it, with no box", async () => {
    await detail(adminVideo(), { "GET /api/jobs": { body: quietQueue } });
    expect(screen.getByRole("button", { name: /^Guarda / })).toBeVisible();
    expect(screen.queryByText("Formato non diretto")).not.toBeInTheDocument();
  });

  it("says a file is unreadable, not that it is yet to read", async () => {
    await detail(
      adminVideo({
        fileProblem: "damaged",
        fileProblemDetail: "exit status 1: moov atom not found",
        duration: null,
        videoCodec: "",
        audioCodec: "",
        format: "",
      }),
      { "GET /api/jobs": { body: quietQueue } },
    );
    expect(screen.queryByText(/Non ancora lett/)).not.toBeInTheDocument();
    const file = screen.getByRole("region", { name: /Il file/ });
    expect(file).toHaveTextContent("File illeggibile");
    expect(file).toHaveTextContent("moov atom not found");
    expect(within(file).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a private video as private in the header", async () => {
    await detail(adminVideo({ private: true }), { "GET /api/jobs": { body: quietQueue } });
    expect(screen.getByText("Privato")).toBeVisible();
  });

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
    expect(
      await server.requests
        .filter((r) => r.method === "PUT")
        .at(-1)
        ?.json(),
    ).toEqual({
      title: "Al mare con la nonna",
      category: "Viaggi",
    });
    expect(screen.getByRole("heading", { level: 1, name: "Al mare con la nonna" })).toBeVisible();
  });

  it("opens every category with words in the field, and saves a new one", async () => {
    const { user, server } = await detail(adminVideo({ category: "Ciao", categorySet: true }), {
      "GET /api/categories": {
        body: [
          { name: "Ciao", videos: 1, color: "", image: null },
          { name: "Viaggi", videos: 3, color: "", image: null },
        ],
      },
      "PUT /api/admin/videos/7/details": { status: 204 },
    });
    const field = screen.getByRole("combobox", { name: "Categoria" });
    await vi.waitFor(async () => {
      await user.click(field);
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Ciao", "Viaggi"]);
    });
    await user.clear(field);
    await user.type(field, "Nuova{Enter}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salva modifiche" }));
    expect(await screen.findByText("Modifiche salvate.")).toBeInTheDocument();
    expect(
      await server.requests
        .filter((r) => r.method === "PUT")
        .at(-1)
        ?.json(),
    ).toEqual({
      title: null,
      category: "Nuova",
    });
  });

  it("leaves a video with no category when the field is emptied", async () => {
    const { user, server } = await detail(adminVideo(), {
      "PUT /api/admin/videos/7/details": { status: 204 },
    });
    await user.clear(screen.getByRole("combobox", { name: "Categoria" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Salva modifiche" }));
    expect(await screen.findByText("Modifiche salvate.")).toBeInTheDocument();
    expect(
      await server.requests
        .filter((r) => r.method === "PUT")
        .at(-1)
        ?.json(),
    ).toEqual({
      title: null,
      category: "",
    });
  });

  it("plays the file itself when this browser can, not its copy", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const { user } = await detail(adminVideo({ copy: true, fileType: "video/webm" }), {
      "GET /api/videos/7/subtitles": { body: [] },
    });
    await user.click(screen.getByRole("button", { name: "Guarda Mare 2024" }));
    expect(document.querySelector("video")).toHaveAttribute(
      "src",
      "/api/videos/7/stream?original=1",
    );
  });

  it("gives the player the subtitles, and follows them when the work changes", async () => {
    stubEventSource();
    const italian = {
      key: "it.vtt",
      lang: "it",
      label: "Italiano",
      src: "/api/videos/7/subtitles/it.vtt",
    };
    const auto = {
      key: "auto-en",
      lang: "en",
      label: "Inglese (automatici)",
      src: "/api/videos/7/subtitles/auto-en",
    };
    const routes = { "GET /api/videos/7/subtitles": { body: [italian] } };
    const { user } = await detail(adminVideo(), routes);
    await user.click(screen.getByRole("button", { name: "Guarda Mare 2024" }));
    expect(await screen.findByRole("button", { name: "Sottotitoli (c)" })).toBeEnabled();
    expect(document.querySelectorAll("track")).toHaveLength(1);
    expect(document.querySelector("track")).toHaveAttribute("src", italian.src);

    routes["GET /api/videos/7/subtitles"].body = [italian, auto];
    act(() => FakeEventSource.last?.emit("jobs"));
    await vi.waitFor(() => expect(document.querySelectorAll("track")).toHaveLength(2));
    expect(document.querySelectorAll("track")[1]).toHaveAttribute("src", auto.src);
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
    expect(
      await server.requests
        .filter((r) => r.method === "PUT")
        .at(-1)
        ?.json(),
    ).toEqual({
      title: null,
      category: null,
    });
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
    expect(
      await server.requests
        .filter((r) => r.method === "PUT")
        .at(-1)
        ?.json(),
    ).toEqual({
      hidden: true,
    });
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
