import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, signedIn, testAccount } from "../../test/render";

describe("profile page", () => {
  it("shows who is logged in", async () => {
    renderApp("/profilo");
    expect(await screen.findByRole("heading", { name: "Paolo" })).toBeInTheDocument();
    expect(screen.getByText("Amministratore")).toBeInTheDocument();
    // The same round initial as on the channel page.
    expect(screen.getByRole("main")).toHaveTextContent(/^P/);
  });

  it("shows a normal user as such", async () => {
    renderApp("/profilo", signedIn({ ...testAccount, name: "Giulia", role: "user" }));
    expect(await screen.findByRole("heading", { name: "Giulia" })).toBeInTheDocument();
    expect(screen.getByText("Utente")).toBeInTheDocument();
  });

  it("leads who may upload to the upload page", async () => {
    renderApp("/profilo");
    expect(await screen.findByRole("link", { name: /Carica un video/ })).toHaveAttribute(
      "href",
      "/carica",
    );
  });

  it("tells who may not upload whom to ask", async () => {
    renderApp("/profilo", signedIn({ ...testAccount, role: "user", canUpload: false }));
    expect(await screen.findByRole("button", { name: /Carica un video/ })).toBeDisabled();
    expect(screen.getByText(/serve il permesso dell'amministratore/)).toBeInTheDocument();
  });

  it("links only to pages the menus do not already show", async () => {
    renderApp("/profilo");
    const pages = await screen.findByRole("navigation", { name: "Le tue pagine" });
    expect(within(pages).getByRole("link", { name: /Cronologia/ })).toBeInTheDocument();
    expect(within(pages).queryByRole("link", { name: /Categorie/ })).not.toBeInTheDocument();
    expect(within(pages).queryByRole("link", { name: /playlist/i })).not.toBeInTheDocument();
  });

  it("links the administrator, and only them, to the administration", async () => {
    renderApp("/profilo");
    const pages = await screen.findByRole("navigation", { name: "Le tue pagine" });
    expect(within(pages).getByRole("link", { name: /Amministrazione/ })).toHaveAttribute(
      "href",
      "/admin",
    );
  });

  it("does not show the administration to a normal user", async () => {
    renderApp("/profilo", signedIn({ ...testAccount, role: "user" }));
    const pages = await screen.findByRole("navigation", { name: "Le tue pagine" });
    expect(within(pages).queryByRole("link", { name: /Amministrazione/ })).not.toBeInTheDocument();
  });

  it("groups the account actions in one list, like the pages above", async () => {
    renderApp("/profilo");
    const account = await screen.findByRole("region", { name: "Il tuo account" });
    const names = within(account)
      .getAllByRole("button")
      .map((b) => b.textContent?.replace("›", "").trim());
    expect(names).toEqual(["Cambia nome", "Cambia accesso Password", "Esci"]);
  });

  it("changes the password after confirming the current one", async () => {
    const { user, server } = renderApp("/profilo", {
      ...signedIn(),
      "POST /api/me/check": { status: 204 },
      "PUT /api/me/credential": { status: 204 },
    });
    await user.click(await screen.findByRole("button", { name: "Cambia accesso Password" }));
    const form = screen.getByRole("form", { name: "Cambia accesso" });
    await user.type(within(form).getByLabelText("Password attuale"), "vecchia-password");
    await user.click(within(form).getByRole("button", { name: "Continua" }));
    expect(await within(form).findByText("Come vuoi entrare d'ora in poi?")).toBeInTheDocument();
    await user.type(within(form).getByLabelText("Nuova password"), "nuova-password");
    await user.type(within(form).getByLabelText("Ripeti la password"), "nuova-passwrod");
    await user.click(within(form).getByRole("button", { name: "Salva" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("non sono uguali");

    await user.clear(within(form).getByLabelText("Ripeti la password"));
    await user.type(within(form).getByLabelText("Ripeti la password"), "nuova-password");
    await user.click(within(form).getByRole("button", { name: "Salva" }));
    expect(await screen.findByText(/Accesso cambiato/)).toHaveAttribute("role", "status");
    expect(screen.queryByRole("form", { name: "Cambia accesso" })).not.toBeInTheDocument();
    const sent = server.requests.find((r) => r.url.endsWith("/api/me/credential"));
    expect(await sent?.json()).toEqual({
      current: "vecchia-password",
      method: "password",
      secret: "nuova-password",
    });
  });

  it("switches to a pattern, with a warning", async () => {
    const { user, server } = renderApp("/profilo", {
      ...signedIn(),
      "POST /api/me/check": { status: 204 },
      "PUT /api/me/credential": { status: 204 },
    });
    await user.click(await screen.findByRole("button", { name: "Cambia accesso Password" }));
    await user.type(screen.getByLabelText("Password attuale"), "vecchia-password");
    await user.click(screen.getByRole("button", { name: "Continua" }));
    await user.click(await screen.findByRole("radio", { name: "Sequenza" }));
    expect(screen.getByText(/meno sicura di una password/)).toBeInTheDocument();
    const draw = async (keys: string) => {
      (await screen.findByRole("button", { name: /^Punto 7/ })).focus();
      await user.keyboard(keys);
      await user.click(screen.getByRole("button", { name: "Fatto" }));
    };
    // Fewer than 5 dots: it says so and stays at step 1.
    await draw(" {ArrowUp} {ArrowUp} ");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unisci almeno 5 punti");
    expect(screen.getByText("Disegna la sequenza")).toBeInTheDocument();
    await draw(" {ArrowUp} {ArrowUp} {ArrowRight} {ArrowRight} ");
    expect(await screen.findByText("5 punti")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continua" }));
    expect(screen.getByText("Ridisegnala per confermare")).toBeInTheDocument();
    // A different pattern: the error, still at step 2; Ricomincia goes back.
    await draw(" {ArrowRight} {ArrowRight} {ArrowUp} {ArrowUp} ");
    expect(await screen.findByRole("alert")).toHaveTextContent("non sono uguali");
    expect(screen.getByText("Ridisegnala per confermare")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ricomincia" }));
    expect(screen.getByText("Disegna la sequenza")).toBeInTheDocument();
    for (const step of [1, 2]) {
      await draw(" {ArrowUp} {ArrowUp} {ArrowRight} {ArrowRight} ");
      if (step === 1) await user.click(await screen.findByRole("button", { name: "Continua" }));
    }
    expect(
      await screen.findByText("Sequenza confermata", { selector: "span" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salva" }));
    await screen.findByText(/Accesso cambiato/);
    const sent = server.requests.find((r) => r.url.endsWith("/api/me/credential"));
    expect(await sent?.json()).toEqual({
      current: "vecchia-password",
      method: "pattern",
      secret: "74123",
    });
  });

  it("stays logged in when the current password is wrong", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/profilo", {
      ...signedIn(),
      "POST /api/me/check": {
        status: 403,
        body: { error: "the current password is not right" },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Cambia accesso Password" }));
    await user.type(screen.getByLabelText("Password attuale"), "sbagliata");
    await user.click(screen.getByRole("button", { name: "Continua" }));
    expect(await screen.findByText("La password non è giusta.")).toBeInTheDocument();
    expect(screen.queryByText("Come vuoi entrare d'ora in poi?")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paolo" })).toBeInTheDocument();
  });

  it("changes my name, everywhere at once", async () => {
    const { user, server } = renderApp("/profilo", {
      ...signedIn(),
      "PUT /api/me/name": { body: { ...testAccount, name: "Paoletto" } },
    });
    await user.click(await screen.findByRole("button", { name: "Cambia nome" }));
    const form = screen.getByRole("form", { name: "Cambia nome" });
    expect(within(form).getByText(/anche il nome con cui entri/)).toBeInTheDocument();
    const field = within(form).getByLabelText("Nuovo nome");
    await user.clear(field);
    await user.type(field, "Pa");
    await user.click(within(form).getByRole("button", { name: "Salva il nome" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("da 3 a 32 caratteri");

    await user.type(field, "oletto");
    await user.click(within(form).getByRole("button", { name: "Salva il nome" }));
    expect(await screen.findByRole("heading", { name: "Paoletto" })).toBeInTheDocument();
    expect(screen.getByText(/Nome cambiato/)).toHaveAttribute("role", "status");
    expect(await server.requests.at(-1)?.json()).toEqual({ name: "Paoletto" });
  });

  it("explains when the name is already used", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/profilo", {
      ...signedIn(),
      "PUT /api/me/name": { status: 409, body: { error: "this name is already used" } },
    });
    await user.click(await screen.findByRole("button", { name: "Cambia nome" }));
    const field = screen.getByLabelText("Nuovo nome");
    await user.clear(field);
    await user.type(field, "Giulia");
    await user.click(screen.getByRole("button", { name: "Salva il nome" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("lo usa già un'altra persona");
    expect(screen.getByRole("heading", { name: "Paolo" })).toBeInTheDocument();
  });

  it("deletes my account after asking for the password", async () => {
    const { user, server } = renderApp("/profilo", {
      ...signedIn({ ...testAccount, role: "user" }),
      "DELETE /api/me": { status: 204 },
    });
    await user.click(await screen.findByRole("button", { name: "Elimina il mio account" }));
    const form = screen.getByRole("form", { name: "Elimina il mio account" });
    expect(form).toHaveTextContent("Non si può tornare indietro");
    const confirm = within(form).getByRole("button", { name: "Elimina per sempre" });
    expect(confirm).toBeDisabled();
    await user.type(within(form).getByLabelText(/password per confermare/), "la-mia-password");
    await user.click(confirm);
    expect(await screen.findByRole("heading", { name: "Accedi a FranzPLAY" })).toBeInTheDocument();
    const sent = server.requests.at(-1);
    expect(sent?.method).toBe("DELETE");
    expect(await sent?.json()).toEqual({ password: "la-mia-password" });
  });

  it("keeps the account when the password is wrong or I am the last administrator", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let status = 403;
    const { user } = renderApp("/profilo", {
      ...signedIn(),
      "DELETE /api/me": () =>
        new Response(JSON.stringify({ error: "no" }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    });
    await user.click(await screen.findByRole("button", { name: "Elimina il mio account" }));
    await user.type(screen.getByLabelText(/password per confermare/), "sbagliata");
    await user.click(screen.getByRole("button", { name: "Elimina per sempre" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La password non è giusta.");

    status = 409;
    await user.click(screen.getByRole("button", { name: "Elimina per sempre" }));
    expect(await screen.findByText(/unico amministratore/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paolo" })).toBeInTheDocument();
  });

  it("chooses the color of the interface", async () => {
    const { user, server } = renderApp("/profilo", {
      ...signedIn(),
      "PUT /api/me/color": async (request) =>
        new Response(
          JSON.stringify({ ...testAccount, accentColor: (await request.clone().json()).color }),
          { headers: { "Content-Type": "application/json" } },
        ),
    });
    const colors = await screen.findByRole("region", { name: "Colore" });
    expect(within(colors).getByRole("button", { name: "FranzPLAY" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Nothing to save until another color is picked in the color window.
    expect(
      within(colors).queryByRole("button", { name: "Usa questo colore" }),
    ).not.toBeInTheDocument();
    await user.click(within(colors).getByRole("button", { name: "Viola" }));
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#7c3aed"),
    );
    expect(within(colors).getByRole("button", { name: "Viola" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await server.requests.at(-1)?.json()).toEqual({ color: "#7c3aed" });

    // Any other color, saved only when asked.
    fireEvent.input(within(colors).getByLabelText("Un altro colore"), {
      target: { value: "#123456" },
    });
    await user.click(within(colors).getByRole("button", { name: "Usa questo colore" }));
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#123456"),
    );

    // Back to the site's own color, the one the administrator chose.
    await user.click(within(colors).getByRole("button", { name: "FranzPLAY" }));
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#2997ff"),
    );
  });

  it("says when the color was not saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/profilo", {
      ...signedIn(),
      "PUT /api/me/color": { status: 500, body: { error: "internal error" } },
    });
    const colors = await screen.findByRole("region", { name: "Colore" });
    await user.click(within(colors).getByRole("button", { name: "Rosso" }));
    expect(await within(colors).findByRole("alert")).toHaveTextContent("Colore non salvato");
    expect(within(colors).getByRole("button", { name: "FranzPLAY" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("starts in the color I chose", async () => {
    renderApp("/profilo", signedIn({ ...testAccount, accentColor: "#0d9488" }));
    expect(await screen.findByRole("button", { name: "Verde acqua" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#0d9488"),
    );
  });

  it("shows the server version", async () => {
    renderApp("/profilo", {
      ...signedIn(),
      "GET /api/health": { body: { status: "ok", version: "1.2.3" } },
    });
    expect(await screen.findByText("FranzPLAY versione 1.2.3")).toBeInTheDocument();
  });

  it("says so when the server does not answer properly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/profilo", {
      ...signedIn(),
      "GET /api/health": { status: 500, body: { status: "down" } },
    });
    expect(await screen.findByText("Il server non risponde.")).toBeInTheDocument();
  });

  it("logs out", async () => {
    const { user } = renderApp("/profilo", {
      ...signedIn(),
      "POST /api/logout": { status: 204 },
    });
    await user.click(await screen.findByRole("button", { name: "Esci" }));
    expect(await screen.findByRole("heading", { name: "Accedi a FranzPLAY" })).toBeInTheDocument();
  });

  it("stays in when logging out fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/profilo", {
      ...signedIn(),
      "POST /api/logout": { status: 500, body: { error: "internal error" } },
    });
    await user.click(await screen.findByRole("button", { name: "Esci" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Uscita non riuscita");
    expect(screen.getByRole("heading", { name: "Paolo" })).toBeInTheDocument();
  });
});
