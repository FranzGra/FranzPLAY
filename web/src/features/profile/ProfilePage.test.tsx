import { screen, within } from "@testing-library/react";
import { renderApp, signedIn, testAccount } from "../../test/render";

describe("profile page", () => {
  it("shows who is logged in", async () => {
    renderApp("/profilo");
    expect(await screen.findByRole("heading", { name: "Francesco" })).toBeInTheDocument();
    expect(screen.getByText("Amministratore")).toBeInTheDocument();
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
