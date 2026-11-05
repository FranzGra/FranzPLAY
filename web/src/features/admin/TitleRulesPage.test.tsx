import { act, screen, waitFor, within } from "@testing-library/react";
import type { TitleRule, TitleSettings } from "../../api/titleRules";
import { type Routes, renderApp, signedIn, testAccount } from "../../test/render";

const underscore: TitleRule = { find: "_", replace: " ", regex: false, on: true };
const tags: TitleRule = { find: "\\[[^\\]]*\\]", replace: "", regex: true, on: true };

const page = (settings: Partial<TitleSettings> = {}) => ({
  settings: { rules: [underscore, tags], categories: false, ...settings },
  presets: [
    { name: "Togli i punti", rule: { find: ".", replace: " ", regex: false, on: true } },
    {
      name: "Togli l'anno",
      rule: { find: "\\b(19|20)\\d\\d\\b", replace: "", regex: true, on: true },
    },
  ],
  examples: [
    { file: "Il_mare_[1080p].mp4", folder: "Vacanze_2024" },
    { file: "Sci_[HDR].mkv", folder: "Vacanze_2024" },
    { file: "Compleanno.mp4", folder: "" },
  ],
});

// apply does what the server does with the rules, enough for the tests: in
// order, only the ones on, without the extension, spaces trimmed.
function apply(rules: TitleRule[], name: string, extension: boolean): string {
  let out = extension ? name.replace(/\.[^.]+$/, "") : name;
  for (const r of rules) {
    if (!r.on || r.find === "") continue;
    out = r.regex
      ? out.replace(new RegExp(r.find, "g"), r.replace)
      : out.split(r.find).join(r.replace);
  }
  return out.replace(/\s+/g, " ").trim();
}

type Asked = { settings: TitleSettings; names: string[]; folders: string[] };

// preview answers like the server's preview, and refuses a regular
// expression JavaScript cannot read as Go would.
async function preview(request: Request): Promise<Response> {
  const asked = (await request.clone().json()) as Asked;
  for (const r of asked.settings.rules) {
    if (!r.regex) continue;
    try {
      new RegExp(r.find);
    } catch {
      return Response.json({ error: `regola ${r.find}: espressione non valida` }, { status: 400 });
    }
  }
  return Response.json({
    titles: asked.names.map((n) => apply(asked.settings.rules, n, true)),
    folders: asked.folders.map((f) =>
      asked.settings.categories ? apply(asked.settings.rules, f, false) : f,
    ),
  });
}

function open(routes: Routes = {}) {
  return renderApp("/admin/regole-titoli", {
    ...signedIn(),
    "GET /api/admin/title-rules": { body: page() },
    "POST /api/admin/title-rules/preview": preview,
    ...routes,
  });
}

const form = () => screen.findByRole("form", { name: "Regole dei titoli" });
const find = (n: number) => screen.getByRole("textbox", { name: `Regola ${n}: testo da cercare` });
const replace = (n: number) =>
  screen.getByRole("textbox", { name: `Regola ${n}: testo che lo sostituisce` });
const row = (n: number) => find(n).closest("li") as HTMLElement;
const finds = () =>
  screen
    .getAllByRole("textbox", { name: /testo da cercare/ })
    .map((i) => (i as HTMLInputElement).value);
const saves = (server: { requests: Request[] }) =>
  server.requests.filter((r) => r.method === "PUT" && r.url.endsWith("/api/admin/title-rules"));
const previews = (server: { requests: Request[] }) =>
  server.requests.filter((r) => r.url.endsWith("/title-rules/preview"));

describe("title rules page", () => {
  it("shows the saved rules in order, with nothing to save", async () => {
    open();
    const rules = await form();
    expect(screen.getByRole("heading", { level: 1, name: "Regole titoli" })).toBeInTheDocument();
    expect(finds()).toEqual(["_", "\\[[^\\]]*\\]"]);
    expect(replace(1)).toHaveValue(" ");
    expect(within(row(2)).getByRole("checkbox", { name: "Espressione regolare" })).toBeChecked();
    expect(
      within(row(1)).getByRole("checkbox", { name: "Espressione regolare" }),
    ).not.toBeChecked();
    expect(within(row(1)).getByRole("checkbox", { name: "Attiva" })).toBeChecked();
    expect(rules).toHaveTextContent("Nessuna modifica da salvare");
    expect(within(rules).queryByRole("button", { name: "Salva regole" })).toBeNull();
  });

  it("says it is loading, then says when the server does not answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    open({ "GET /api/admin/title-rules": { status: 500, body: { error: "boom" } } });
    expect(
      await screen.findByRole("heading", { name: "Regole non disponibili" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Regole dei titoli" })).toBeNull();
  });

  it("does not trust an answer of the wrong shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    open({
      "GET /api/admin/title-rules": {
        body: {
          ...page(),
          settings: { rules: [{ find: 1, replace: "", regex: false, on: true }] },
        },
      },
    });
    expect(
      await screen.findByRole("heading", { name: "Regole non disponibili" }),
    ).toBeInTheDocument();
  });

  it("explains the title when there are no rules", async () => {
    open({ "GET /api/admin/title-rules": { body: page({ rules: [] }) } });
    const rules = await form();
    expect(rules).toHaveTextContent(
      "Nessuna regola: il titolo è il nome del file senza l'estensione",
    );
    expect(screen.queryByRole("textbox", { name: /testo da cercare/ })).toBeNull();
  });

  it("is only for the administrator", async () => {
    const { server } = renderApp("/admin/regole-titoli", {
      ...signedIn({ ...testAccount, role: "user" }),
      "GET /api/admin/title-rules": { body: page() },
    });
    expect(
      await screen.findByRole("heading", { name: "Solo per l'amministratore" }),
    ).toBeInTheDocument();
    expect(server.requests.some((r) => r.url.includes("/title-rules"))).toBe(false);
  });

  it("previews the rules on a typed name and on the videos of the library", async () => {
    const { user } = open();
    await form();
    // The default example: underscores become spaces, the tag goes away.
    expect(await screen.findByText("Il mio video")).toBeInTheDocument();
    expect(screen.getByText("Il mare")).toBeInTheDocument();
    expect(screen.getByText("Sci")).toBeInTheDocument();
    expect(screen.getByText("Compleanno")).toBeInTheDocument();

    const typed = screen.getByRole("textbox", { name: "Prova un nome di file" });
    await user.clear(typed);
    await user.paste("Perché_sì_🎬_[4K].mov");
    expect(await screen.findByText("Perché sì 🎬")).toBeInTheDocument();
  });

  it("previews rules not saved yet, without saving them", async () => {
    const { user, server } = open();
    await form();
    await screen.findByText("Il mio video");
    // Turning off the first rule leaves the underscores.
    await user.click(within(row(1)).getByRole("checkbox", { name: "Attiva" }));
    expect(row(1)).toHaveAttribute("data-off");
    expect(await screen.findByText("Il_mio_video_")).toBeInTheDocument();
    const last = (await previews(server).at(-1)?.clone().json()) as Asked | undefined;
    expect(last?.settings.rules[0]?.on).toBe(false);
    expect(saves(server)).toHaveLength(0);
  });

  it("shows why a regular expression is wrong, in place of the titles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = open();
    await form();
    await screen.findByText("Il mio video");
    await user.clear(find(2));
    await user.click(find(2));
    await user.paste("([unclosed");
    expect(await screen.findByRole("alert")).toHaveTextContent("espressione non valida");
    expect(screen.queryByText("Il mio video")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);

    // Fixed, the titles come back.
    await user.clear(find(2));
    await user.click(find(2));
    await user.paste("\\[(\\w+)\\]");
    expect(await screen.findByText("Il mio video")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the preview cannot be made", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    open({
      "POST /api/admin/title-rules/preview": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await form();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Non riesco a mostrare l'anteprima ora.",
    );
  });

  it("keeps the newest preview when an older one answers late", async () => {
    const held: { answer?: (r: Response) => void } = {};
    const { user } = open({
      "POST /api/admin/title-rules/preview": async (request) => {
        const asked = (await request.clone().json()) as Asked;
        if (asked.names[0] === "lento.mp4") {
          return new Promise<Response>((resolve) => {
            held.answer = resolve;
          });
        }
        return preview(request);
      },
    });
    await form();
    await screen.findByText("Il mio video");
    const typed = screen.getByRole("textbox", { name: "Prova un nome di file" });
    await user.clear(typed);
    await user.paste("lento.mp4");
    await waitFor(() => expect(held.answer).toBeDefined());
    await user.clear(typed);
    await user.paste("veloce_[x].mp4");
    expect(await screen.findByText("veloce")).toBeInTheDocument();
    await act(async () =>
      held.answer?.(Response.json({ titles: ["VECCHIO", "", "", ""], folders: [] })),
    );
    expect(screen.queryByText("VECCHIO")).toBeNull();
    expect(screen.getByText("veloce")).toBeInTheDocument();
  });

  it("previews the category names only when the rules apply to them", async () => {
    const { user, server } = open();
    await form();
    await screen.findByText("Il mio video");
    expect(screen.queryByText("Vacanze 2024")).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Applica anche alle categorie" }));
    expect(await screen.findByText("Vacanze 2024")).toBeInTheDocument();
    // Each folder once, the videos at the top of the library left out.
    const asked = (await previews(server).at(-1)?.clone().json()) as Asked | undefined;
    expect(asked?.folders).toEqual(["Vacanze_2024"]);
    expect(asked?.settings.categories).toBe(true);
  });

  it("saves the rules and says how many titles changed", async () => {
    const { user, server } = open({
      "PUT /api/admin/title-rules": async (request) => {
        const settings = (await request.clone().json()) as TitleSettings;
        return Response.json({ settings, changed: 3 });
      },
    });
    const rules = await form();
    await user.clear(replace(1));
    await user.type(replace(1), "-");
    expect(rules).not.toHaveTextContent("Nessuna modifica da salvare");
    await user.click(within(rules).getByRole("button", { name: "Salva regole" }));
    expect(await within(rules).findByRole("status")).toHaveTextContent(
      "Salvato. Titoli aggiornati su 3 video.",
    );
    expect(rules).toHaveTextContent("Nessuna modifica da salvare");
    expect(await saves(server)[0]?.json()).toEqual({
      rules: [{ ...underscore, replace: "-" }, tags],
      categories: false,
    });
  });

  it("says when no title changed", async () => {
    const { user } = open({
      "PUT /api/admin/title-rules": async (request) =>
        Response.json({ settings: await request.clone().json(), changed: 0 }),
    });
    const rules = await form();
    await user.click(screen.getByRole("switch", { name: "Applica anche alle categorie" }));
    await user.click(within(rules).getByRole("button", { name: "Salva regole" }));
    expect(await within(rules).findByRole("status")).toHaveTextContent(
      "Salvato. Nessun titolo è cambiato.",
    );
  });

  it("shows the server's reason for a refused rule, and keeps the edits", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = open({
      "PUT /api/admin/title-rules": {
        status: 400,
        body: { error: "regola 2: espressione regolare non valida" },
      },
    });
    const rules = await form();
    await user.click(within(row(2)).getByRole("checkbox", { name: "Attiva" }));
    await user.click(within(rules).getByRole("button", { name: "Salva regole" }));
    expect(await within(rules).findByRole("alert")).toHaveTextContent(
      "regola 2: espressione regolare non valida",
    );
    expect(within(row(2)).getByRole("checkbox", { name: "Attiva" })).not.toBeChecked();
    expect(within(rules).getByRole("button", { name: "Salva regole" })).toBeEnabled();
  });

  it.each([
    [500, { error: "internal" }],
    [403, { error: "admin only" }],
    [200, { settings: { rules: [] } }],
  ])("says to try again when saving answers %i badly", async (status, body) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = open({ "PUT /api/admin/title-rules": { status, body } });
    const rules = await form();
    await user.click(within(row(1)).getByRole("button", { name: "Togli la regola 1" }));
    await user.click(within(rules).getByRole("button", { name: "Salva regole" }));
    expect(await within(rules).findByRole("alert")).toHaveTextContent(
      "Non sono riuscito a salvare. Riprova tra poco.",
    );
  });

  it("disables the rules while saving", async () => {
    let answer: (r: Response) => void = () => {};
    const { user } = open({
      "PUT /api/admin/title-rules": () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const rules = await form();
    await user.click(within(row(1)).getByRole("button", { name: "Togli la regola 1" }));
    await user.click(within(rules).getByRole("button", { name: "Salva regole" }));
    expect(within(rules).getByRole("button", { name: "Salvo…" })).toBeDisabled();
    expect(find(1)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aggiungi regola" })).toBeDisabled();
    await act(async () =>
      answer(Response.json({ settings: { rules: [tags], categories: false }, changed: 1 })),
    );
    expect(await within(rules).findByRole("status")).toHaveTextContent("1 video");
    expect(find(1)).toBeEnabled();
  });

  it("puts the rules back as saved with Annulla", async () => {
    const { user, server } = open();
    const rules = await form();
    await user.click(within(row(1)).getByRole("button", { name: "Togli la regola 1" }));
    await user.click(screen.getByRole("button", { name: "Togli i punti" }));
    expect(finds()).toEqual(["\\[[^\\]]*\\]", "."]);
    await user.click(within(rules).getByRole("button", { name: "Annulla" }));
    expect(finds()).toEqual(["_", "\\[[^\\]]*\\]"]);
    expect(rules).toHaveTextContent("Nessuna modifica da salvare");
    expect(saves(server)).toHaveLength(0);
  });

  it("moves the rules up and down, and saves the new order", async () => {
    const { user, server } = open({
      "PUT /api/admin/title-rules": async (request) =>
        Response.json({ settings: await request.clone().json(), changed: 2 }),
    });
    const rules = await form();
    // The first cannot go up, the last cannot go down.
    expect(within(row(1)).getByRole("button", { name: "Sposta su la regola 1" })).toBeDisabled();
    expect(within(row(2)).getByRole("button", { name: "Sposta giù la regola 2" })).toBeDisabled();

    await user.click(within(row(1)).getByRole("button", { name: "Sposta giù la regola 1" }));
    expect(finds()).toEqual(["\\[[^\\]]*\\]", "_"]);
    // Each rule keeps what was typed in it while it moves.
    expect(replace(2)).toHaveValue(" ");
    await user.click(screen.getByRole("button", { name: "Togli l'anno" }));
    await user.click(within(row(3)).getByRole("button", { name: "Sposta su la regola 3" }));
    expect(finds()).toEqual(["\\[[^\\]]*\\]", "\\b(19|20)\\d\\d\\b", "_"]);

    await user.click(within(rules).getByRole("button", { name: "Salva regole" }));
    await within(rules).findByRole("status");
    const sent = (await saves(server)[0]?.json()) as TitleSettings;
    expect(sent.rules.map((r) => r.find)).toEqual(["\\[[^\\]]*\\]", "\\b(19|20)\\d\\d\\b", "_"]);
  });

  it("adds an empty rule, or a ready one, at the end", async () => {
    const { user } = open();
    await form();
    await user.click(screen.getByRole("button", { name: "Aggiungi regola" }));
    expect(finds()).toEqual(["_", "\\[[^\\]]*\\]", ""]);
    expect(within(row(3)).getByRole("checkbox", { name: "Attiva" })).toBeChecked();
    expect(
      within(row(3)).getByRole("checkbox", { name: "Espressione regolare" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Togli l'anno" }));
    expect(finds().at(-1)).toBe("\\b(19|20)\\d\\d\\b");
    expect(within(row(4)).getByRole("checkbox", { name: "Espressione regolare" })).toBeChecked();
  });

  it("stops at 30 rules", async () => {
    const many = Array.from({ length: 29 }, (_, i) => ({ ...underscore, find: `x${i}` }));
    const { user } = open({ "GET /api/admin/title-rules": { body: page({ rules: many }) } });
    await form();
    expect(screen.queryByText("Al massimo 30 regole.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Aggiungi regola" }));
    expect(finds()).toHaveLength(30);
    expect(screen.getByText("Al massimo 30 regole.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aggiungi regola" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Togli i punti" })).toBeDisabled();
  });

  it("says when a replacement is only spaces", async () => {
    const { user } = open();
    await form();
    expect(replace(1)).toHaveAccessibleDescription("Uno spazio");
    await user.type(replace(1), "  ");
    expect(replace(1)).toHaveAccessibleDescription("3 spazi");
    await user.type(replace(1), "-");
    expect(replace(1)).not.toHaveAttribute("aria-describedby");
    expect(replace(2)).not.toHaveAttribute("aria-describedby");
  });

  it("does not let a text to find grow past the limit", async () => {
    open();
    await form();
    expect(find(1)).toHaveAttribute("maxLength", "200");
    expect(replace(1)).toHaveAttribute("maxLength", "200");
  });
});
