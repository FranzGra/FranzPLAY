import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
import { renderCover } from "./coverImage";

// jsdom has no real images or canvas: the two browser-only steps are faked.
vi.mock("../profile/photo", () => ({
  loadPhoto: vi.fn(async () => ({ url: "blob:picture", width: 1600, height: 1600 })),
}));
vi.mock("./coverImage", () => ({
  renderCover: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));

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

// openCover opens the page of the video on the tab of the cover asked.
async function openCover(
  routes: Record<string, unknown>,
  tab = "Immagine",
  video: Record<string, unknown> = adminVideo(),
) {
  const app = renderApp("/admin/video/7", {
    ...signedIn(),
    "GET /api/admin/videos/7": { body: video },
    ...routes,
  });
  await screen.findByRole("heading", { level: 1, name: "Mare 2024" }, { timeout: 3000 });
  const panel = screen.getByRole("region", { name: "Copertina di Mare 2024" });
  await app.user.click(within(panel).getByRole("tab", { name: tab }));
  return { ...app, panel };
}

const preview = {
  src: "/api/previews/7-abc.jpg",
  gap: 10,
  count: 24,
  columns: 6,
  width: 160,
  height: 90,
};

// bothOn is the answer about the sources with TMDB and ThePornDB ready.
const bothOn = {
  youtube: false,
  tmdb: true,
  tpdb: true,
  tmdbKey: true,
  tpdbKey: true,
  rules: { from: 0, to: 0, daily: 0, order: ["youtube", "tmdb", "tpdb"], confirm: false },
  askedToday: 0,
  proposals: 0,
};

// answerOf is one answer of a search.
function answerOf(title: string, match: number, overrides: Record<string, unknown> = {}) {
  return {
    title,
    match,
    date: "",
    author: "",
    picture: "",
    thumb: "",
    source: "tmdb",
    sourceName: "TMDB",
    ...overrides,
  };
}

describe("choosing a cover", () => {
  it("has four ways to choose, as tabs", async () => {
    const { panel } = await openCover({}, "Dal video");
    const tabs = within(panel).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Dal video",
      "Immagine",
      "Internet",
      "Automatica",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getByRole("tabpanel")).toBeInTheDocument();
  });

  it("uploads an image cut to the shape of a cover", async () => {
    const { user, server, panel } = await openCover({
      "PUT /api/admin/videos/7/cover": { status: 204 },
    });
    expect(panel).toHaveTextContent("Automatica: la sceglie FranzPLAY.");
    const file = new File(["x"], "foto.png", { type: "image/png" });
    fireEvent.change(within(panel).getByLabelText("Carica un'immagine"), {
      target: { files: [file] },
    });
    const dialog = await screen.findByRole("dialog", { name: "Sistema la copertina" });
    // The window is 272 × 153; a square picture 1600 wide fills its width,
    // so the window shows 1600 × 900 of it, from the middle. Moved up by
    // one step of 10 window pixels, the cut goes down by 10 / 0.17 pixels.
    fireEvent.keyDown(within(dialog).getByRole("img", { name: /Immagine da ritagliare/ }), {
      key: "ArrowDown",
    });
    await user.click(within(dialog).getByRole("button", { name: "Usa come copertina" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(vi.mocked(renderCover)).toHaveBeenCalledWith("blob:picture", {
      x: expect.closeTo(0),
      y: expect.closeTo(350 + 10 / 0.17),
      width: expect.closeTo(1600),
      height: expect.closeTo(900),
    });
    const sent = server.requests.find((r) => r.method === "PUT");
    expect(sent?.url).toContain("/api/admin/videos/7/cover");
    expect(sent?.headers.get("Content-Type")).toBe("image/jpeg");
    expect(
      await screen.findByText("In coda: la nuova copertina arriva tra poco."),
    ).toBeInTheDocument();
    expect(within(panel).getByText("Preparo la nuova copertina…")).toBeInTheDocument();
  });

  it("uses the exact second when the frames are not ready", async () => {
    const { user, server, panel } = await openCover(
      { "PUT /api/admin/videos/7/cover-second": { status: 204 } },
      "Dal video",
    );
    const second = within(panel).getByRole("spinbutton", { name: /Secondo/ });
    fireEvent.change(second, { target: { value: "75" } });
    await user.click(within(panel).getByRole("button", { name: "Usa 1:15 come copertina" }));
    await waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
    const sent = server.requests.find((r) => r.method === "PUT");
    expect(await sent?.json()).toEqual({ second: 75 });
  });

  it("moves the video with the slider, one seek at a time", async () => {
    const { server, panel } = await openCover(
      { "PUT /api/admin/videos/7/cover-second": { status: 204 } },
      "Dal video",
    );
    const video = panel.querySelector("video") as HTMLVideoElement;
    let seeking = false;
    Object.defineProperty(video, "seeking", { get: () => seeking });
    const slider = within(panel).getByRole("slider", { name: "Momento del video" });
    expect(slider).toHaveAttribute("max", "245");

    fireEvent.change(slider, { target: { value: "30" } });
    expect(video.currentTime).toBe(30);
    expect(slider).toHaveAttribute("aria-valuetext", "0:30");

    // The video is still looking for the frame: the moves only change where
    // it goes next, and the slider is not pulled back meanwhile.
    seeking = true;
    fireEvent.change(slider, { target: { value: "40" } });
    fireEvent.change(slider, { target: { value: "75" } });
    expect(video.currentTime).toBe(30);
    fireEvent.timeUpdate(video);
    expect(within(panel).getByRole("spinbutton", { name: /Secondo/ })).toHaveValue(75);

    seeking = false;
    fireEvent.seeked(video);
    expect(video.currentTime).toBe(75);

    fireEvent.click(within(panel).getByRole("button", { name: "Usa 1:15 come copertina" }));
    await waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
    const sent = server.requests.find((r) => r.method === "PUT");
    expect(await sent?.json()).toEqual({ second: 75 });
  });

  it("follows the video when it is stopped with its own controls", async () => {
    const { panel } = await openCover({}, "Dal video");
    const video = panel.querySelector("video") as HTMLVideoElement;
    video.currentTime = 12.7;
    fireEvent.timeUpdate(video);
    expect(within(panel).getByRole("slider", { name: "Momento del video" })).toHaveValue("12");
  });

  it("picks one of the moments of the video", async () => {
    const { user, server, panel } = await openCover(
      { "PUT /api/admin/videos/7/cover-second": { status: 204 } },
      "Dal video",
      adminVideo({ preview }),
    );
    const moments = within(panel).getAllByRole("radio", { name: /Il momento/ });
    expect(moments).toHaveLength(12);
    expect(within(panel).getByRole("button", { name: "Scegli un momento" })).toBeDisabled();
    await user.click(moments[0] as HTMLElement);
    await user.click(within(panel).getByRole("button", { name: "Usa 0:10 come copertina" }));
    await waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
    const sent = server.requests.find((r) => r.method === "PUT");
    expect(await sent?.json()).toEqual({ second: 10 });
  });

  it("goes back to the cover FranzPLAY picks", async () => {
    const { user, server, panel } = await openCover(
      { "DELETE /api/admin/videos/7/cover": { status: 204 } },
      "Automatica",
      adminVideo({ coverChoice: "image" }),
    );
    expect(panel).toHaveTextContent("un'immagine caricata da te");
    await user.click(within(panel).getByRole("button", { name: "Torna a quella automatica" }));
    await waitFor(() => expect(server.requests.some((r) => r.method === "DELETE")).toBe(true));
    expect(
      await screen.findByText("La copertina la sceglie di nuovo FranzPLAY."),
    ).toBeInTheDocument();
  });

  it("puts the new cover in place by itself when it is ready", async () => {
    stubEventSource();
    let video = adminVideo();
    const { user, panel } = await openCover(
      {
        "GET /api/admin/videos/7": () => new Response(JSON.stringify(video)),
        "PUT /api/admin/videos/7/cover-second": { status: 204 },
      },
      "Dal video",
    );
    fireEvent.change(within(panel).getByRole("spinbutton", { name: /Secondo/ }), {
      target: { value: "30" },
    });
    await user.click(within(panel).getByRole("button", { name: "Usa 0:30 come copertina" }));
    expect(await within(panel).findByText("Preparo la nuova copertina…")).toBeInTheDocument();
    // The queue makes it: the video gets a cover with a new address.
    video = adminVideo({
      cover: "/api/covers/7-ffff.jpg",
      coverChoice: "moment",
      coverSecond: 30,
    });
    act(() => FakeEventSource.last?.emit("jobs"));
    expect(await screen.findByText("Copertina aggiornata.")).toBeInTheDocument();
    expect(within(panel).getByRole("img", { name: "La copertina di adesso" })).toHaveAttribute(
      "src",
      "/api/covers/7-ffff.jpg",
    );
    expect(within(panel).queryByText("Preparo la nuova copertina…")).not.toBeInTheDocument();
    expect(panel).toHaveTextContent("Scelta: il momento 0:30 del video.");
  });

  it("says when the image is too large", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user, panel } = await openCover({
      "PUT /api/admin/videos/7/cover": { status: 413, body: { error: "too large" } },
    });
    fireEvent.change(within(panel).getByLabelText("Carica un'immagine"), {
      target: { files: [new File(["x"], "foto.png", { type: "image/png" })] },
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Usa come copertina" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("troppo grande");
  });

  it("searches the internet and uses a picture found", async () => {
    const online = {
      youtube: false,
      tmdb: true,
      tpdb: true,
      tmdbKey: true,
      tpdbKey: false,
      rules: { from: 0, to: 0, daily: 0, order: ["youtube", "tmdb", "tpdb"], confirm: false },
      askedToday: 0,
      proposals: 0,
    };
    const { user, server, panel } = await openCover(
      {
        "GET /api/online": { body: online },
        "GET /api/online/search": {
          body: {
            results: [
              answerOf("Mare d'estate", 40, {
                date: "2024-07-01",
                picture: "/w1280/mare.jpg",
                thumb: "/w780/mare.jpg",
              }),
              answerOf("Senza foto", 0),
            ],
            problems: [],
          },
        },
        "GET /api/online/picture": () =>
          new Response("jpeg", { headers: { "Content-Type": "image/jpeg" } }),
        "PUT /api/admin/videos/7/cover": { status: 204 },
      },
      "Internet",
    );
    // Only TMDB has its key: no choice of source, but it says which one.
    const words = await within(panel).findByRole("searchbox", { name: "Cosa cercare" });
    expect(words).toHaveValue("Mare 2024");
    expect(within(panel).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(panel).getByText("TMDB (film)")).toBeInTheDocument();
    await user.clear(words);
    await user.type(words, "mare estate");
    await user.click(within(panel).getByRole("button", { name: "Cerca" }));

    const found = await within(panel).findByRole("list", { name: "Immagini trovate" });
    const search = new URL(server.requests.at(-1)?.url ?? "");
    expect(search.searchParams.get("source")).toBe("tmdb");
    expect(search.searchParams.get("q")).toBe("mare estate");
    expect(search.searchParams.get("title")).toBe("Mare 2024");
    const [first, second] = within(found).getAllByRole("button");
    expect(second).toBeDisabled();
    expect(first?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/online/picture?source=tmdb&at=%2Fw780%2Fmare.jpg",
    );
    expect(first).toHaveTextContent("40% · in parte");
    expect(first).toHaveTextContent("TMDB");
    expect(second).toHaveTextContent("0% · titolo diverso");
    expect(panel).toHaveTextContent("del titolo del video, «Mare 2024». Non guarda l'immagine.");

    await user.click(first as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Sistema la copertina" });
    expect(server.requests.some((r) => r.url.includes("at=%2Fw1280%2Fmare.jpg"))).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Usa come copertina" }));
    await waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
    expect(server.requests.find((r) => r.method === "PUT")?.url).toContain(
      "/api/admin/videos/7/cover",
    );
  });

  it("says how to turn a source on to search the internet", async () => {
    const off = {
      youtube: true,
      tmdb: false,
      tpdb: true,
      tmdbKey: true,
      tpdbKey: false,
      rules: { from: 0, to: 0, daily: 0, order: ["youtube", "tmdb", "tpdb"], confirm: false },
      askedToday: 0,
      proposals: 0,
    };
    const { panel } = await openCover({ "GET /api/online": { body: off } }, "Internet");
    expect(await within(panel).findByText(/accendi TMDB o ThePornDB/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /Amministrazione › Internet/ })).toHaveAttribute(
      "href",
      "/admin/internet",
    );
    expect(within(panel).queryByRole("button", { name: "Cerca" })).not.toBeInTheDocument();
  });

  it("searches all the sources or only one", async () => {
    const { user, server, panel } = await openCover(
      {
        "GET /api/online": { body: bothOn },
        "GET /api/online/search": {
          body: {
            results: [
              answerOf("Mare 2024", 100, {
                source: "tpdb",
                sourceName: "ThePornDB",
                picture: "https://cdn.theporndb.net/l.jpg",
                thumb: "https://cdn.theporndb.net/s.jpg",
              }),
              answerOf("Mare", 67, { picture: "/w1280/a.jpg", thumb: "/w780/a.jpg" }),
            ],
            problems: [],
          },
        },
      },
      "Internet",
    );
    const where = await within(panel).findByRole("combobox", { name: "Dove cercare" });
    expect(where).toHaveTextContent("Tutte le fonti (2)");
    const searches = () => server.requests.filter((r) => r.url.includes("/api/online/search"));
    // Nothing is asked until the button: not while writing.
    await user.type(within(panel).getByRole("searchbox", { name: "Cosa cercare" }), " mare");
    expect(searches()).toHaveLength(0);

    await user.click(within(panel).getByRole("button", { name: "Cerca" }));
    const found = await within(panel).findByRole("list", { name: "Immagini trovate" });
    expect(searches()).toHaveLength(1);
    expect(new URL(searches()[0]?.url ?? "").searchParams.get("source")).toBe("all");
    // In the order the server gave, with the picture from its own source.
    const items = within(found).getAllByRole("button");
    expect(items[0]).toHaveTextContent("100% · stesse parole");
    expect(items[0]).toHaveTextContent("ThePornDB");
    expect(items[0]?.querySelector("img")?.getAttribute("src")).toContain("source=tpdb");
    expect(items[1]).toHaveTextContent("67% · in parte");
    expect(items[1]?.querySelector("img")?.getAttribute("src")).toContain("source=tmdb");

    await user.click(where);
    await user.click(await screen.findByRole("option", { name: "ThePornDB" }));
    expect(within(panel).queryByRole("list", { name: "Immagini trovate" })).not.toBeInTheDocument();
    expect(searches()).toHaveLength(1);
    await user.click(within(panel).getByRole("button", { name: "Cerca" }));
    await within(panel).findByRole("list", { name: "Immagini trovate" });
    expect(new URL(searches()[1]?.url ?? "").searchParams.get("source")).toBe("tpdb");
  });

  it("keeps the answers when a source fails, and says so", async () => {
    const { user, panel } = await openCover(
      {
        "GET /api/online": { body: bothOn },
        "GET /api/online/search": {
          body: {
            results: [answerOf("Mare", 67)],
            problems: [{ source: "tpdb", sourceName: "ThePornDB", kind: "down" }],
          },
        },
      },
      "Internet",
    );
    await within(panel).findByRole("combobox", { name: "Dove cercare" });
    await user.click(within(panel).getByRole("button", { name: "Cerca" }));
    expect(await within(panel).findByText(/ThePornDB non risponde/)).toBeInTheDocument();
    expect(within(panel).getByRole("list", { name: "Immagini trovate" })).toBeInTheDocument();
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says when every source failed, and when nothing was found", async () => {
    let answer: unknown = {
      results: [],
      problems: [
        { source: "tmdb", sourceName: "TMDB", kind: "key" },
        { source: "tpdb", sourceName: "ThePornDB", kind: "down" },
      ],
    };
    const { user, panel } = await openCover(
      {
        "GET /api/online": { body: bothOn },
        "GET /api/online/search": () => new Response(JSON.stringify(answer)),
      },
      "Internet",
    );
    await within(panel).findByRole("combobox", { name: "Dove cercare" });
    await user.click(within(panel).getByRole("button", { name: "Cerca" }));
    const alert = await within(panel).findByRole("alert");
    expect(alert).toHaveTextContent("TMDB non accetta più la chiave");
    expect(alert).toHaveTextContent("ThePornDB non risponde");
    expect(panel).not.toHaveTextContent("Nessun risultato");

    answer = { results: [], problems: [] };
    await user.click(within(panel).getByRole("button", { name: "Cerca" }));
    expect(await within(panel).findByText(/Nessun risultato/)).toBeInTheDocument();
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says what a failed search of one source means", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user, panel } = await openCover(
      {
        "GET /api/online": { body: { ...bothOn, tpdb: false } },
        "GET /api/online/search": { status: 422, body: { error: "TMDB refused the key" } },
      },
      "Internet",
    );
    await within(panel).findByRole("searchbox", { name: "Cosa cercare" });
    await user.click(within(panel).getByRole("button", { name: "Cerca" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "TMDB non accetta più la chiave",
    );
  });
});
