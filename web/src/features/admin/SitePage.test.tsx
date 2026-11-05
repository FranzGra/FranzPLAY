import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

const franz = { nameFirst: "Franz", nameSecond: "PLAY", color: "#2997ff" };

describe("site name and color", () => {
  it("changes them for the whole page at once", async () => {
    const saved = { nameFirst: "Casa", nameSecond: "Rossi", color: "#dc2626" };
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "PUT /api/site": { body: saved },
    });
    const form = await screen.findByRole("form", { name: "Nome e colore del sito" });
    // Nothing changed yet: no grey button, a word that all is saved.
    expect(within(form).queryByRole("button", { name: "Salva nome e colore" })).toBeNull();
    expect(form).toHaveTextContent("Nessuna modifica da salvare");

    const first = within(form).getByLabelText("Prima parte del nome");
    await user.clear(first);
    await user.type(first, "Casa");
    const second = within(form).getByLabelText("Seconda parte (nel colore)");
    await user.clear(second);
    await user.type(second, "Rossi");
    await user.click(within(form).getByRole("button", { name: "Rosso" }));
    expect(within(form).getByRole("button", { name: "Rosso" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(form).getByText("Anteprima del nome").closest("figure")).toHaveTextContent(
      "CasaRossi",
    );

    await user.click(within(form).getByRole("button", { name: "Salva nome e colore" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("Salvato");
    // The shape of the category covers goes too, as it was.
    expect(await server.lastSent()?.json()).toEqual({ ...saved, categoryShape: "landscape" });
    // The logo at the top and the color of the page follow.
    expect(screen.getByRole("link", { name: "CasaRossi" })).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#dc2626");
    expect(document.title).toBe("Amministrazione · CasaRossi");
  });

  it("leaves the shape of the category covers to the Categories page", async () => {
    renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
    });
    await screen.findByRole("form", { name: "Nome e colore del sito" });
    expect(screen.queryByRole("group", { name: "Forma delle copertine" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Copertine delle categorie" })).toBeNull();
  });

  it("chooses where the clips start and how long they last", async () => {
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "GET /api/admin/clip-settings": { body: { startPercent: 0, seconds: 6 } },
      "PUT /api/admin/clip-settings": { body: { startPercent: 20, seconds: 8 } },
    });
    const form = await screen.findByRole("form", { name: "Anteprime dei video" });
    // As FranzPLAY always made them: three moments, six seconds.
    expect(within(form).getByRole("radio", { name: "Automatica" })).toBeChecked();
    expect(form).toHaveTextContent("a un quarto, a metà e a tre quarti");
    expect(within(form).getByRole("spinbutton", { name: "Durata (secondi)" })).toHaveValue(6);
    expect(within(form).queryByRole("button", { name: "Salva anteprime" })).toBeNull();

    await user.click(within(form).getByRole("radio", { name: "Da un punto fisso" }));
    const point = within(form).getByRole("spinbutton", {
      name: "Punto di partenza (% della durata)",
    });
    await user.clear(point);
    await user.type(point, "20");
    const length = within(form).getByRole("spinbutton", { name: "Durata (secondi)" });
    await user.clear(length);
    await user.type(length, "8");
    await user.click(within(form).getByRole("button", { name: "Salva anteprime" }));
    expect(await within(form).findByRole("status")).toHaveTextContent(
      "Vale per le anteprime fatte da adesso",
    );
    expect(await server.lastSent()?.json()).toEqual({ startPercent: 20, seconds: 8 });
  });

  it("goes back to the automatic start", async () => {
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "GET /api/admin/clip-settings": { body: { startPercent: 20, seconds: 8 } },
      "PUT /api/admin/clip-settings": { body: { startPercent: 0, seconds: 8 } },
    });
    const form = await screen.findByRole("form", { name: "Anteprime dei video" });
    expect(within(form).getByRole("radio", { name: "Da un punto fisso" })).toBeChecked();
    await user.click(within(form).getByText("Automatica"));
    expect(within(form).getByRole("radio", { name: "Automatica" })).toBeChecked();
    expect(within(form).queryByRole("spinbutton", { name: /Punto di partenza/ })).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Salva anteprime" }));
    await within(form).findByRole("status");
    expect(await server.lastSent()?.json()).toEqual({ startPercent: 0, seconds: 8 });
  });

  it("refuses clips longer than the server makes", async () => {
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "GET /api/admin/clip-settings": { body: { startPercent: 0, seconds: 6 } },
    });
    const form = await screen.findByRole("form", { name: "Anteprime dei video" });
    const length = within(form).getByRole("spinbutton", { name: "Durata (secondi)" });
    await user.clear(length);
    await user.type(length, "45");
    await user.click(within(form).getByRole("button", { name: "Salva anteprime" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("tra 2 e 30 secondi");
    expect(
      server.requests.some((r) => r.url.endsWith("/clip-settings") && r.method === "PUT"),
    ).toBe(false);
  });

  it("does not send a name without its first part", async () => {
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
    });
    const form = await screen.findByRole("form", { name: "Nome e colore del sito" });
    await user.clear(within(form).getByLabelText("Prima parte del nome"));
    await user.click(within(form).getByRole("button", { name: "Salva nome e colore" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("almeno la prima parte");
    expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("shows the name the administrator chose, even before logging in", async () => {
    renderApp("/", {
      ...signedIn(),
      "GET /api/me": { status: 401, body: { error: "login required" } },
      "GET /api/setup": { body: { needed: false, codeNeeded: false, openRegistration: false } },
      "GET /api/site": { body: { ...franz, nameFirst: "Cinema", nameSecond: "" } },
    });
    expect(await screen.findByRole("heading", { name: "Accedi a Cinema" })).toBeInTheDocument();
  });
});

describe("site settings page", () => {
  it("opens registration to anyone, then closes it", async () => {
    let open = false;
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "PUT /api/registration": () => {
        open = !open;
        return new Response(JSON.stringify({ open }));
      },
    });
    const box = await screen.findByRole("switch", { name: "Chiunque può registrarsi" });
    expect(box).not.toBeChecked();

    await user.click(box);
    expect(await screen.findByRole("status")).toHaveTextContent("Registrazione aperta");
    expect(box).toBeChecked();
    expect(await server.lastSent()?.json()).toEqual({ open: true });

    await user.click(box);
    expect(await screen.findByRole("status")).toHaveTextContent("Registrazione chiusa");
    expect(box).not.toBeChecked();
  });

  it("says when saving did not work", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "PUT /api/registration": { status: 500, body: { error: "boom" } },
    });
    await user.click(await screen.findByRole("switch", { name: "Chiunque può registrarsi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Non si è riusciti a salvare");
    expect(screen.getByRole("switch", { name: "Chiunque può registrarsi" })).not.toBeChecked();
  });
});

describe("site name and color, when saving fails", () => {
  it.each([
    [400, "Il nome o il colore non vanno bene"],
    [500, "Non si è riusciti a salvare. Riprova tra poco."],
  ])("explains a refusal %i and keeps the name typed", async (status, words) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "PUT /api/site": { status, body: { error: "no" } },
    });
    const form = await screen.findByRole("form", { name: "Nome e colore del sito" });
    const first = within(form).getByLabelText("Prima parte del nome");
    await user.clear(first);
    await user.type(first, "Casa è mia 🎬");
    await user.click(within(form).getByRole("button", { name: "Salva nome e colore" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(words);
    expect(first).toHaveValue("Casa è mia 🎬");
    // The logo at the top did not change.
    expect(screen.getByRole("link", { name: "FranzPLAY" })).toBeInTheDocument();
  });

  it("puts the saved name back with Annulla", async () => {
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
    });
    const form = await screen.findByRole("form", { name: "Nome e colore del sito" });
    const first = within(form).getByLabelText("Prima parte del nome");
    await user.type(first, "!!");
    await user.click(within(form).getByRole("button", { name: "Annulla" }));
    expect(first).toHaveValue("Franz");
    expect(form).toHaveTextContent("Nessuna modifica da salvare");
    expect(server.lastSent()).toBeUndefined();
  });
});

describe("who may enter", () => {
  const routes = (methods: string[], save?: (r: Request) => Response | Promise<Response>) => ({
    ...signedIn(),
    "GET /api/registration": { body: { open: false } },
    "GET /api/login-methods": { body: { methods } },
    ...(save ? { "PUT /api/login-methods": save } : {}),
  });
  const echo = async (request: Request) =>
    Response.json({ methods: ((await request.clone().json()) as { methods: string[] }).methods });

  it("lists the ways to log in, each with its state", async () => {
    renderApp("/admin/sito", routes(["password", "pin"]));
    const list = await screen.findByRole("list", { name: "Modi per entrare" });
    expect(within(list).getByRole("switch", { name: "Password" })).toBeChecked();
    expect(within(list).getByRole("switch", { name: "PIN" })).toBeChecked();
    expect(within(list).getByRole("switch", { name: "Sequenza" })).not.toBeChecked();
    expect(within(list).getByRole("switch", { name: "Sequenza" })).toHaveAccessibleDescription(
      /almeno 5 punti su 9/,
    );
  });

  it("allows a way, in the order of the list", async () => {
    const { user, server } = renderApp("/admin/sito", routes(["password", "pattern"], echo));
    const list = await screen.findByRole("list", { name: "Modi per entrare" });
    await user.click(within(list).getByRole("switch", { name: "PIN" }));
    expect(await screen.findByText(/PIN ammesso: le persone possono sceglierlo/)).toHaveAttribute(
      "role",
      "status",
    );
    expect(await server.lastSent()?.json()).toEqual({ methods: ["password", "pin", "pattern"] });
    expect(within(list).getByRole("switch", { name: "PIN" })).toBeChecked();
  });

  it("takes a way away, and says what happens to who uses it", async () => {
    const { user, server } = renderApp("/admin/sito", routes(["password", "pattern"], echo));
    const list = await screen.findByRole("list", { name: "Modi per entrare" });
    await user.click(within(list).getByRole("switch", { name: "Sequenza" }));
    expect(await screen.findByText(/Sequenza non più ammessa\. Chi lo usa entra ancora/)).toBe(
      screen.getAllByRole("status").at(-1),
    );
    expect(await server.lastSent()?.json()).toEqual({ methods: ["password"] });
    // The last one left cannot be turned off.
    expect(within(list).getByRole("switch", { name: "Password" })).toBeDisabled();
  });

  it("never leaves nobody a way in", async () => {
    const { server } = renderApp("/admin/sito", routes(["pin"], echo));
    const list = await screen.findByRole("list", { name: "Modi per entrare" });
    expect(within(list).getByRole("switch", { name: "PIN" })).toBeDisabled();
    expect(within(list).getByRole("switch", { name: "Password" })).toBeEnabled();
    expect(server.lastSent()).toBeUndefined();
  });

  it("says when the choice was not saved, and keeps the old one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp(
      "/admin/sito",
      routes(["password"], () => Response.json({ error: "boom" }, { status: 500 })),
    );
    const list = await screen.findByRole("list", { name: "Modi per entrare" });
    await user.click(within(list).getByRole("switch", { name: "PIN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Non si è riusciti a salvare. Riprova tra poco.",
    );
    expect(within(list).getByRole("switch", { name: "PIN" })).not.toBeChecked();
  });

  it("says when the ways cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/admin/sito", {
      ...routes([]),
      "GET /api/login-methods": { status: 500, body: { error: "boom" } },
    });
    expect(
      await screen.findByRole("heading", { name: "Modi di accesso non disponibili" }),
    ).toBeInTheDocument();
  });

  it("says when registration cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { status: 503, body: { error: "down" } },
      "GET /api/admin/clip-settings": { body: { startPercent: 0, seconds: 6 } },
    });
    await screen.findByRole("form", { name: "Anteprime dei video" });
    expect(
      await screen.findByRole("heading", { name: "Impostazioni non disponibili" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Chiunque può registrarsi" })).toBeNull();
  });
});
