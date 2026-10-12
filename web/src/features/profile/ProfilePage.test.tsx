import { screen, within } from "@testing-library/react";
import { renderApp, signedIn, testAccount } from "../../test/render";

describe("profile page", () => {
  it("shows who is logged in", async () => {
    renderApp("/profilo");
    expect(await screen.findByRole("heading", { name: "Francesco" })).toBeInTheDocument();
    expect(screen.getByText("Amministratore")).toBeInTheDocument();
    // The same round initial as on the channel page.
    expect(screen.getByRole("main")).toHaveTextContent(/^F/);
  });

  it("shows a normal user as such", async () => {
    renderApp("/profilo", signedIn({ ...testAccount, name: "Giulia", role: "user" }));
    expect(await screen.findByRole("heading", { name: "Giulia" })).toBeInTheDocument();
    expect(screen.getByText("Utente")).toBeInTheDocument();
  });

  it("has the upload button, disabled until uploading exists", async () => {
    renderApp("/profilo");
    expect(await screen.findByRole("button", { name: /Carica un video/ })).toBeDisabled();
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

  it("changes the password", async () => {
    const { user, server } = renderApp("/profilo", {
      ...signedIn(),
      "POST /api/me/password": { status: 204 },
    });
    await user.click(await screen.findByRole("button", { name: "Cambia password" }));
    const form = screen.getByRole("form", { name: "Cambia password" });
    await user.type(within(form).getByLabelText("Password attuale"), "vecchia-password");
    await user.type(within(form).getByLabelText("Nuova password"), "nuova-password");
    await user.type(within(form).getByLabelText("Ripeti la nuova password"), "nuova-passwrod");
    await user.click(within(form).getByRole("button", { name: "Cambia password" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("non sono uguali");

    await user.clear(within(form).getByLabelText("Ripeti la nuova password"));
    await user.type(within(form).getByLabelText("Ripeti la nuova password"), "nuova-password");
    await user.click(within(form).getByRole("button", { name: "Cambia password" }));
    expect(await screen.findByText(/Password cambiata/)).toHaveAttribute("role", "status");
    expect(screen.queryByRole("form", { name: "Cambia password" })).not.toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({
      current: "vecchia-password",
      new: "nuova-password",
    });
  });

  it("stays logged in when the current password is wrong", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/profilo", {
      ...signedIn(),
      "POST /api/me/password": {
        status: 403,
        body: { error: "the current password is not right" },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Cambia password" }));
    await user.type(screen.getByLabelText("Password attuale"), "sbagliata");
    await user.type(screen.getByLabelText("Nuova password"), "nuova-password");
    await user.type(screen.getByLabelText("Ripeti la nuova password"), "nuova-password");
    await user.click(
      within(screen.getByRole("form")).getByRole("button", { name: "Cambia password" }),
    );
    expect(await screen.findByText("La password attuale non è giusta.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Francesco" })).toBeInTheDocument();
  });

  it("changes my name, everywhere at once", async () => {
    const { user, server } = renderApp("/profilo", {
      ...signedIn(),
      "PUT /api/me/name": { body: { ...testAccount, name: "Franz" } },
    });
    await user.click(await screen.findByRole("button", { name: "Cambia nome" }));
    const form = screen.getByRole("form", { name: "Cambia nome" });
    expect(within(form).getByText(/anche il nome con cui entri/)).toBeInTheDocument();
    const field = within(form).getByLabelText("Nuovo nome");
    await user.clear(field);
    await user.type(field, "Fr");
    await user.click(within(form).getByRole("button", { name: "Salva il nome" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("da 3 a 32 caratteri");

    await user.type(field, "anz");
    await user.click(within(form).getByRole("button", { name: "Salva il nome" }));
    expect(await screen.findByRole("heading", { name: "Franz" })).toBeInTheDocument();
    expect(screen.getByText(/Nome cambiato/)).toHaveAttribute("role", "status");
    expect(await server.requests.at(-1)?.json()).toEqual({ name: "Franz" });
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
    expect(screen.getByRole("heading", { name: "Francesco" })).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Francesco" })).toBeInTheDocument();
  });
});
