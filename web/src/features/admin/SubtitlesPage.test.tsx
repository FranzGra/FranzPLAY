import { act, screen, within } from "@testing-library/react";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { renderApp, signedIn } from "../../test/render";

const setup = {
  whisper: true,
  models: ["medium", "small"],
  translator: true,
  translatorError: "",
  translatorLanguages: ["en", "it", "de"],
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
    { lang: "it", source: "auto", from: "" },
    { lang: "de", source: "auto", from: "it" },
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

describe("subtitles page", () => {
  it("lists the videos with their subtitles and the work asked", async () => {
    renderApp("/admin/sottotitoli", routes());
    await screen.findByRole("list", { name: "Video" });
    expect(screen.getByText("Whisper è pronto. Modelli: medium, small")).toBeInTheDocument();
    expect(rowOf("Mare 2024")).toHaveTextContent("Nessun sottotitolo");
    expect(rowOf("Lago")).toHaveTextContent("Inglese · nel video");
    expect(rowOf("Lago")).toHaveTextContent("Italiano · automatici");
    expect(rowOf("Lago")).toHaveTextContent("Tedesco · tradotti");
    expect(rowOf("Bosco")).toHaveTextContent("Non riuscito: modello small, tradotti in inglese.");
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

  it("asks whisper for subtitles and their translations", async () => {
    const { user, server } = renderApp("/admin/sottotitoli", {
      ...routes(),
      "PUT /api/admin/subtitles/7": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Crea sottotitoli" }));
    const form = screen.getByRole("form", { name: "Sottotitoli di Mare 2024" });
    await user.click(within(form).getByRole("combobox", { name: "Lingua parlata nel video" }));
    await user.click(screen.getByRole("option", { name: "Italiano" }));
    // Only the languages the translator knows, and not the spoken one.
    expect(within(form).queryByRole("checkbox", { name: "Italiano" })).not.toBeInTheDocument();
    expect(within(form).queryByRole("checkbox", { name: "Spagnolo" })).not.toBeInTheDocument();
    await user.click(within(form).getByRole("checkbox", { name: "Inglese" }));
    await user.click(within(form).getByRole("button", { name: "Crea" }));
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
      within(rowOf("Mare 2024")).queryByRole("button", { name: "Crea sottotitoli" }),
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
    expect(screen.getByText(/FRANZPLAY_TRANSLATE_URL/)).toBeInTheDocument();
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
    renderApp(
      "/admin/sottotitoli",
      routes([video()], {
        ...setup,
        download: { name: "base", done: 71 << 20, total: 142 << 20, error: "", ended: false },
      }),
    );
    await screen.findByRole("list", { name: "Video" });
    expect(screen.getByText("Scarico base: 71 MB di 142 MB…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scarica base" })).toBeDisabled();
  });
});
