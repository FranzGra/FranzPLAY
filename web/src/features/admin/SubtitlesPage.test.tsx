import { act, screen, within } from "@testing-library/react";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { renderApp, signedIn } from "../../test/render";

const setup = {
  whisper: true,
  models: ["medium", "small"],
  translator: true,
  translatorError: "",
  translatorLanguages: ["en", "it", "de"],
  translatorHelp: {
    off: "Serve il motore Prova.",
    down: "Il motore Prova dorme: svegliallo.",
    setup: "RIGA_DA_COPIARE=1",
    after: "Poi riavvia.",
  },
  languages: ["it", "en", "es", "fr", "de", "pt"],
  modelsFolder: "/srv/franzplay/whisper",
  downloadable: [
    { name: "base", size: 142 << 20, about: "Veloce." },
    { name: "small", size: 466 << 20, about: "Il giusto mezzo." },
  ],
  download: null as unknown,
};

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: "Mare 2024",
    cover: null,
    subtitles: [],
    request: null,
    ...overrides,
  };
}

const lago = video({
  id: 8,
  title: "Lago",
  subtitles: [
    { lang: "en", source: "inside", from: "" },
    { lang: "it", source: "auto", from: "", model: "small" },
    { lang: "de", source: "auto", from: "it", model: "small" },
  ],
});

const failed = {
  spoken: "",
  model: "small",
  translate: ["en"],
  stage: "",
  state: "failed",
  error: "whisper-cli: exit status 1",
  at: "2026-10-12T20:00:00Z",
};

const bosco = video({ id: 9, title: "Bosco", request: failed });

function rowOf(name: string) {
  const list = screen.getByRole("list", { name: "Video" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByText(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

function routes(videos = [video(), lago, bosco], ready: Record<string, unknown> = setup) {
  return {
    ...signedIn(),
    "GET /api/admin/subtitles/setup": { body: ready },
    "GET /api/admin/subtitles": { body: { videos, total: videos.length } },
  };
}

function openModels(user: ReturnType<typeof renderApp>["user"]) {
  return user.click(screen.getByRole("button", { name: "Altri modelli" }));
}

describe("subtitles page", () => {
  beforeEach(() => window.localStorage.clear());

  it("lists the videos with their subtitles and the work asked", async () => {
    renderApp("/admin/sottotitoli", routes());
    await screen.findByRole("list", { name: "Video" });
    expect(screen.getByText("Whisper è pronto")).toBeInTheDocument();
    expect(screen.getByText("Modelli: medium, small")).toBeInTheDocument();
    expect(rowOf("Mare 2024")).toHaveTextContent("Nessun sottotitolo");
    expect(rowOf("Lago")).toHaveTextContent("Inglese · nel video");
    expect(rowOf("Lago")).toHaveTextContent("Italiano · originale");
    expect(rowOf("Lago")).toHaveTextContent("Tedesco · tradotto dall'italiano");
    expect(rowOf("Bosco")).toHaveTextContent("Trascrizione non riuscita: modello small");
    expect(rowOf("Bosco")).toHaveTextContent("whisper-cli: exit status 1");
    expect(within(rowOf("Bosco")).getByRole("button", { name: "Riprova" })).toBeInTheDocument();
    expect(screen.getByText("3 video")).toBeInTheDocument();
  });

  it("filters by subtitles and language", async () => {
    const { user, server } = renderApp("/admin/sottotitoli", routes());
    await screen.findByRole("list", { name: "Video" });
    await user.click(screen.getByRole("button", { name: "Senza sottotitoli" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("have=without"));
    await user.click(screen.getByRole("combobox", { name: "Lingua dei sottotitoli" }));
    await user.click(screen.getByRole("option", { name: "Italiano" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("lang=it"));
  });

  it("asks for the original language before listening", async () => {
    const { user, server } = renderApp("/admin/sottotitoli", {
      ...routes(),
      "PUT /api/admin/subtitles/7": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Trascrivi" }));
    const form = screen.getByRole("form", { name: "Trascrivi Mare 2024" });
    await user.click(within(form).getByRole("button", { name: "Trascrivi" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Scegli la lingua");
    expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
    // Not knowing it can be said, but it has to be said.
    await user.click(within(form).getByRole("combobox", { name: "Lingua originale del video" }));
    await user.click(screen.getByRole("option", { name: "Non la so: la riconosce Whisper" }));
    await user.click(within(form).getByRole("button", { name: "Trascrivi" }));
    await vi.waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
    const put = server.requests.find((r) => r.method === "PUT");
    expect(await put?.json()).toEqual({ spoken: "auto", model: "small", translate: [] });
  });

  it("fills in the language it knows, and warns when the file disagrees", async () => {
    const { user } = renderApp("/admin/sottotitoli", routes([video({ audioLangs: ["en"] })]));
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Trascrivi" }));
    const form = screen.getByRole("form", { name: "Trascrivi Mare 2024" });
    const field = within(form).getByRole("combobox", { name: "Lingua originale del video" });
    expect(field).toHaveTextContent("Inglese");
    expect(form).toHaveTextContent("Lo dice il file video");
    await user.click(field);
    await user.click(screen.getByRole("option", { name: "Italiano" }));
    expect(form).toHaveTextContent("Il file dice che l'audio è in Inglese");
  });

  it("says which models the translator has and how the download goes", async () => {
    renderApp(
      "/admin/sottotitoli",
      routes(
        [
          video({
            title: "Mare 2024",
            translation: {
              source: "auto",
              from: "en",
              to: ["it"],
              redo: false,
              state: "running",
              error: "",
              at: "2026-10-30T10:00:00Z",
              stage: "model",
              startedAt: "2026-10-30T10:00:00Z",
              progress: 25,
              done: 9_000_000,
              total: 36_000_000,
            },
          }),
        ],
        {
          ...setup,
          translatorModels: { have: ["en-it"], name: "it-en", done: 18_000_000, total: 36_000_000 },
        },
      ),
    );
    const box = await screen.findByRole("region", { name: "Traduttore" });
    expect(box).toHaveTextContent("Il traduttore è pronto");
    expect(box).toHaveTextContent("Già scaricati: Inglese → Italiano.");
    expect(box).toHaveTextContent("Scarico il modello Italiano → Inglese");
    expect(within(box).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(box).toHaveTextContent("50%");
    expect(box).not.toHaveTextContent(/LibreTranslate|FRANZPLAY_/);
    const row = rowOf("Mare 2024");
    expect(row).toHaveTextContent("scarico il modello, solo la prima volta");
    expect(row).not.toHaveTextContent("frasi");
  });

  it("translates without listening again", async () => {
    const { user, server } = renderApp("/admin/sottotitoli", {
      ...routes(),
      "PUT /api/admin/subtitles/8/translation": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Lago")).getByRole("button", { name: "Traduci" }));
    const form = screen.getByRole("form", { name: "Traduci Lago" });
    expect(form).toHaveTextContent("non riascolta il video");
    // The first to start from is whisper's: Italian, not itself a target.
    expect(within(form).getByRole("combobox", { name: "Traduci da" })).toHaveTextContent(
      "Italiano · scritti da Whisper",
    );
    expect(within(form).queryByRole("checkbox", { name: /^Italiano/ })).not.toBeInTheDocument();
    // What is already there cannot be chosen, until it is asked to redo it.
    const english = within(form).getByRole("checkbox", { name: "Inglese · già presente" });
    const german = within(form).getByRole("checkbox", { name: "Tedesco · già presente" });
    expect(english).toBeDisabled();
    expect(german).toBeDisabled();
    await user.click(within(form).getByRole("button", { name: "Traduci" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("almeno una lingua");
    await user.click(
      within(form).getByRole("checkbox", { name: "Rifai le traduzioni già presenti" }),
    );
    // Only a translation can be made again: not what is inside the video.
    expect(english).toBeDisabled();
    await user.click(within(form).getByRole("checkbox", { name: "Tedesco" }));
    await user.click(within(form).getByRole("button", { name: "Traduci" }));
    await vi.waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
    const put = server.requests.find((r) => r.method === "PUT");
    expect(put?.url).toContain("/api/admin/subtitles/8/translation");
    expect(await put?.json()).toEqual({ source: "auto", from: "it", to: ["de"], redo: true });
  });

  it("explains what to do when there is nothing to translate", async () => {
    const { user } = renderApp("/admin/sottotitoli", routes());
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Traduci" }));
    const form = screen.getByRole("form", { name: "Traduci Mare 2024" });
    expect(form).toHaveTextContent("Non c'è ancora un testo da tradurre");
    expect(form).toHaveTextContent("Prima usa Trascrivi");
    expect(within(form).queryByRole("button", { name: "Traduci" })).not.toBeInTheDocument();
  });

  it("explains a file that does not say its language", async () => {
    const { user } = renderApp(
      "/admin/sottotitoli",
      routes([video({ subtitles: [{ lang: "", source: "file", from: "" }] })]),
    );
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Traduci" }));
    expect(screen.getByRole("form", { name: "Traduci Mare 2024" })).toHaveTextContent(
      "l'unico modo è rinominarlo",
    );
  });

  it("says the words of the engine when the translator is off", async () => {
    const { user } = renderApp(
      "/admin/sottotitoli",
      routes([lago], { ...setup, translator: false, translatorLanguages: [] }),
    );
    await screen.findByRole("list", { name: "Video" });
    expect(screen.getByText("Il traduttore è spento")).toBeInTheDocument();
    expect(screen.queryByText("Serve il motore Prova.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Come attivarlo" }));
    expect(screen.getByText("Serve il motore Prova.")).toBeInTheDocument();
    expect(screen.getByText("RIGA_DA_COPIARE=1")).toBeInTheDocument();
    await user.click(within(rowOf("Lago")).getByRole("button", { name: "Traduci" }));
    const form = screen.getByRole("form", { name: "Traduci Lago" });
    expect(form).toHaveTextContent("Il traduttore è spento, quindi ora non si può tradurre");
    expect(within(form).queryByRole("button", { name: "Traduci" })).not.toBeInTheDocument();
  });

  it("says the words of the engine when the translator does not answer", async () => {
    renderApp(
      "/admin/sottotitoli",
      routes([video()], {
        ...setup,
        translatorError: "Il traduttore non risponde.",
        translatorLanguages: [],
      }),
    );
    await screen.findByRole("list", { name: "Video" });
    expect(screen.getByRole("alert")).toHaveTextContent("Il motore Prova dorme");
  });

  it("shows how a translation goes", async () => {
    const asked = {
      source: "auto",
      from: "en",
      to: ["it"],
      redo: false,
      at: "2026-10-12T20:00:00Z",
      error: "",
    };
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const { user, server } = renderApp("/admin/sottotitoli", {
      ...routes([
        video({
          translation: { ...asked, state: "running", startedAt, progress: 30, done: 12, total: 40 },
        }),
        lago,
        video({
          id: 10,
          title: "Colle",
          translation: { ...asked, state: "pending" },
        }),
        video({
          id: 11,
          title: "Riva",
          translation: { ...asked, state: "pending", error: "answered 500" },
        }),
        video({
          id: 12,
          title: "Prato",
          translation: { ...asked, state: "failed", error: "video 12: the translator is off" },
        }),
      ]),
      "PUT /api/admin/subtitles/12/translation": { status: 204 },
      "DELETE /api/admin/subtitles/7/translation": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    const row = rowOf("Mare 2024");
    expect(row).toHaveTextContent("Traduzione in italiano dall'inglese");
    expect(
      within(row).getByRole("progressbar", { name: "Traduzione di Mare 2024" }),
    ).toHaveAttribute("aria-valuenow", "30");
    expect(row).toHaveTextContent("12 di 40 frasi");
    expect(within(row).queryByRole("button", { name: "Trascrivi" })).not.toBeInTheDocument();
    expect(rowOf("Colle")).toHaveTextContent("parte appena finiscono i lavori in corso");
    expect(rowOf("Riva")).toHaveTextContent("si è interrotta, riprovo da solo");
    // A known error in words, from the engine.
    expect(rowOf("Prato")).toHaveTextContent("Serve il motore Prova.");
    await user.click(within(rowOf("Prato")).getByRole("button", { name: "Riprova la traduzione" }));
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.url.endsWith("/subtitles/12/translation"))).toBe(true),
    );
    await user.click(within(row).getByRole("button", { name: "Annulla la traduzione" }));
    await vi.waitFor(() =>
      expect(
        server.requests.some(
          (r) => r.method === "DELETE" && r.url.endsWith("/subtitles/7/translation"),
        ),
      ).toBe(true),
    );
  });

  it("keeps the box of models to one line, until it is opened", async () => {
    const { user } = renderApp("/admin/sottotitoli", routes());
    await screen.findByRole("list", { name: "Video" });
    expect(screen.queryByRole("list", { name: "Modelli da scaricare" })).not.toBeInTheDocument();
    await openModels(user);
    expect(screen.getByRole("list", { name: "Modelli da scaricare" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chiudi" })).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("franzplay.subtitles.modelsOpen")).toBe("1");
  });

  it("shows a download with its Annulla in the closed box", async () => {
    const { server, user } = renderApp("/admin/sottotitoli", {
      ...routes([video()], {
        ...setup,
        download: { name: "base", done: 71 << 20, total: 142 << 20, error: "", ended: false },
      }),
      "DELETE /api/admin/subtitles/download": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    expect(screen.queryByRole("list", { name: "Modelli da scaricare" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Scarico il modello base" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Scarico base50%");
    await user.click(screen.getByRole("button", { name: "Annulla il download di base" }));
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.url.endsWith("/api/admin/subtitles/download"))).toBe(
        true,
      ),
    );
  });

  it("asks whisper for subtitles and their translations", async () => {
    const { user, server } = renderApp("/admin/sottotitoli", {
      ...routes(),
      "PUT /api/admin/subtitles/7": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Trascrivi" }));
    const form = screen.getByRole("form", { name: "Trascrivi Mare 2024" });
    await user.click(within(form).getByRole("combobox", { name: "Lingua originale del video" }));
    await user.click(screen.getByRole("option", { name: "Italiano" }));
    // Only the languages the translator knows, and not the spoken one.
    expect(within(form).queryByRole("checkbox", { name: "Italiano" })).not.toBeInTheDocument();
    expect(within(form).queryByRole("checkbox", { name: "Spagnolo" })).not.toBeInTheDocument();
    await user.click(within(form).getByRole("checkbox", { name: "Inglese" }));
    await user.click(within(form).getByRole("button", { name: "Trascrivi" }));
    await vi.waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
    const put = server.requests.find((r) => r.method === "PUT");
    expect(await put?.json()).toEqual({ spoken: "it", model: "small", translate: ["en"] });
  });

  it("deletes subtitles it made and takes a request back", async () => {
    const { user, server } = renderApp("/admin/sottotitoli", {
      ...routes(),
      "DELETE /api/admin/subtitles/8/made/de": { status: 204 },
      "DELETE /api/admin/subtitles/9/request": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    // Only the automatic ones can be deleted.
    expect(within(rowOf("Lago")).getAllByRole("button", { name: /Cancella/ })).toHaveLength(2);
    await user.click(
      within(rowOf("Lago")).getByRole("button", {
        name: "Cancella i sottotitoli automatici in tedesco",
      }),
    );
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.url.endsWith("/api/admin/subtitles/8/made/de"))).toBe(
        true,
      ),
    );
    await user.click(within(rowOf("Bosco")).getByRole("button", { name: "Annulla" }));
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.url.endsWith("/api/admin/subtitles/9/request"))).toBe(
        true,
      ),
    );
  });

  it("explains how to turn whisper on", async () => {
    renderApp("/admin/sottotitoli", routes([video()], { ...setup, whisper: false, models: [] }));
    await screen.findByRole("list", { name: "Video" });
    expect(screen.getByText("I sottotitoli automatici sono spenti")).toBeInTheDocument();
    expect(
      within(rowOf("Mare 2024")).queryByRole("button", { name: "Trascrivi" }),
    ).not.toBeInTheDocument();
  });

  it("says where the model goes when there is none", async () => {
    renderApp(
      "/admin/sottotitoli",
      routes([video()], { ...setup, models: [], translator: false, translatorLanguages: [] }),
    );
    await screen.findByRole("list", { name: "Video" });
    expect(screen.getByText("Manca il modello di Whisper")).toBeInTheDocument();
    expect(screen.getByText("/srv/franzplay/whisper")).toBeInTheDocument();
    // With no model the box stays open, and there is nothing to close.
    expect(screen.getByRole("list", { name: "Modelli da scaricare" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Altri modelli" })).not.toBeInTheDocument();
  });

  it("follows the work as it moves", async () => {
    stubEventSource();
    let videos = [video()];
    renderApp("/admin/sottotitoli", {
      ...routes(),
      "GET /api/admin/subtitles": () =>
        new Response(JSON.stringify({ videos, total: videos.length })),
    });
    await screen.findByRole("list", { name: "Video" });
    videos = [
      video({
        request: { ...failed, state: "running", stage: "transcribe", error: "" },
      }),
    ];
    act(() => FakeEventSource.last?.emit("jobs"));
    expect(await screen.findByText(/Whisper sta ascoltando/)).toBeInTheDocument();
  });
  it("downloads a model and shows how it goes", async () => {
    const { user, server } = renderApp("/admin/sottotitoli", {
      ...routes([video()], { ...setup, models: ["small"] }),
      "POST /api/admin/subtitles/models/base": { status: 202 },
    });
    await screen.findByRole("list", { name: "Video" });
    await openModels(user);
    const models = screen.getByRole("list", { name: "Modelli da scaricare" });
    expect(within(models).getByText("Già qui")).toBeInTheDocument();
    await user.click(within(models).getByRole("button", { name: "Scarica base" }));
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.url.endsWith("/api/admin/subtitles/models/base"))).toBe(
        true,
      ),
    );
  });

  it("shows a download going on", async () => {
    const { user } = renderApp(
      "/admin/sottotitoli",
      routes([video()], {
        ...setup,
        download: {
          name: "base",
          done: 71 << 20,
          total: 142 << 20,
          error: "",
          ended: false,
          speed: 1 << 20,
        },
      }),
    );
    await screen.findByRole("list", { name: "Video" });
    await openModels(user);
    const models = screen.getByRole("list", { name: "Modelli da scaricare" });
    // The bar sits under the row of its own model, not elsewhere on the page.
    const row = within(models)
      .getAllByRole("listitem")
      .find((li) => within(li).queryByText("base"));
    if (!row) throw new Error("no row for base");
    expect(within(row).getByRole("status")).toHaveTextContent("Scarico base50%");
    // How much came, how fast, and how long it still takes.
    expect(row).toHaveTextContent("71 MB di 142 MB · 50% · 1 MB/s · restano circa 1 min");
    expect(within(row).getByRole("button", { name: "Annulla il download di base" })).toBeEnabled();
    expect(
      within(row).getByRole("progressbar", { name: "Scarico il modello base" }),
    ).toHaveAttribute("aria-valuenow", "50");
    expect(within(row).queryByRole("button", { name: "Scarica base" })).not.toBeInTheDocument();
    // While one model comes, the others wait.
    for (const button of within(models).queryAllByRole("button", { name: /^Scarica / })) {
      expect(button).toBeDisabled();
    }
  });

  it("stops a download with Annulla", async () => {
    let download: Record<string, unknown> = {
      name: "base",
      done: 10 << 20,
      total: 142 << 20,
      error: "",
      ended: false,
    };
    const { user, server } = renderApp("/admin/sottotitoli", {
      ...routes([video()]),
      "GET /api/admin/subtitles/setup": () => new Response(JSON.stringify({ ...setup, download })),
      "DELETE /api/admin/subtitles/download": () => {
        download = { ...download, ended: true, canceled: true, error: "Download annullato." };
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await screen.findByRole("button", { name: "Altri modelli" }));
    await user.click(await screen.findByRole("button", { name: "Annulla il download di base" }));
    expect(await screen.findByText("Download di base annullato.")).toBeInTheDocument();
    expect(
      server.requests.some(
        (r) => r.method === "DELETE" && r.url.endsWith("/api/admin/subtitles/download"),
      ),
    ).toBe(true);
    // Stopped is not failed: no red message, and it can be downloaded again.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scarica base" })).toBeEnabled();
  });

  it("shows how far whisper listened to a video", async () => {
    const startedAt = new Date(Date.now() - 600_000).toISOString(); // 10 minutes ago
    renderApp(
      "/admin/sottotitoli",
      routes([
        video({
          request: {
            ...failed,
            state: "running",
            stage: "transcribe",
            error: "",
            startedAt,
            progress: 37,
            heardSeconds: 725,
            totalSeconds: 1960,
          },
        }),
      ]),
    );
    await screen.findByRole("list", { name: "Video" });
    const row = rowOf("Mare 2024");
    expect(
      within(row).getByRole("progressbar", { name: "Trascrizione di Mare 2024" }),
    ).toHaveAttribute("aria-valuenow", "37");
    expect(row).toHaveTextContent("37%");
    expect(row).toHaveTextContent("12:05 di 32:40 ascoltati");
    expect(row).toHaveTextContent("restano circa 17 min");
  });
});
