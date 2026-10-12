import { screen } from "@testing-library/react";
import { type Routes, renderApp, testAccount } from "../../test/render";
import { checkSetup } from "./AuthPage";

const signedOut: Routes = {
  "GET /api/me": { status: 401, body: { error: "login required" } },
  "GET /api/setup": { body: { needed: false } },
};

const newFranzPLAY: Routes = {
  ...signedOut,
  "GET /api/setup": { body: { needed: true } },
};

describe("login", () => {
  it("is shown when nobody is logged in", async () => {
    renderApp("/profilo", signedOut);
    expect(await screen.findByRole("heading", { name: "Accedi a FranzPLAY" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Menu principale" })).not.toBeInTheDocument();
  });

  it("enters FranzPLAY with the right password", async () => {
    const { user, server } = renderApp("/profilo", {
      ...signedOut,
      "POST /api/login": { body: testAccount },
    });
    await user.type(await screen.findByLabelText("Nome"), "Francesco");
    await user.type(screen.getByLabelText("Password"), "una-password");
    await user.click(screen.getByRole("button", { name: "Entra" }));

    // It stays on the page that was asked for.
    expect(await screen.findByRole("heading", { name: "Francesco" })).toBeInTheDocument();
    const sent = server.requests.find((r) => r.url.endsWith("/api/login"));
    expect(await sent?.json()).toEqual({ name: "Francesco", password: "una-password" });
  });

  it.each([
    [401, "Nome o password sbagliati."],
    [429, "Troppe password sbagliate. Aspetta un minuto e riprova."],
    [500, "Qualcosa è andato storto sul server. Riprova tra poco."],
  ])("explains a %i answer", async (status, message) => {
    const { user } = renderApp("/", {
      ...signedOut,
      "POST /api/login": { status, body: { error: "refused" } },
    });
    await user.type(await screen.findByLabelText("Nome"), "Francesco");
    await user.type(screen.getByLabelText("Password"), "sbagliata");
    await user.click(screen.getByRole("button", { name: "Entra" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Entra" })).toBeEnabled();
  });

  it("goes back to the login when the session expires", async () => {
    let expired = false;
    const { user } = renderApp("/", {
      "GET /api/me": () =>
        expired
          ? new Response(JSON.stringify({ error: "login required" }), { status: 401 })
          : new Response(JSON.stringify(testAccount)),
      "GET /api/setup": { body: { needed: false } },
      "GET /api/health": () =>
        new Response(JSON.stringify({ error: "login required" }), { status: 401 }),
    });
    expired = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await user.click(await screen.findByRole("link", { name: "Profilo" }));
    expect(await screen.findByRole("heading", { name: "Accedi a FranzPLAY" })).toBeInTheDocument();
  });
});

describe("first setup", () => {
  it("asks for the code and creates the administrator", async () => {
    const { user, server } = renderApp("/", {
      ...newFranzPLAY,
      "POST /api/setup": { status: 201, body: testAccount },
    });
    expect(
      await screen.findByRole("heading", { name: "Benvenuto in FranzPLAY" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Codice di installazione"), "ABCD-EFGH-JKMN");
    await user.type(screen.getByLabelText("Nome"), "Francesco");
    await user.type(screen.getByLabelText("Password"), "una-password");
    await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
    await user.click(screen.getByRole("button", { name: "Crea e entra" }));

    expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
    const sent = server.requests.find((r) => r.method === "POST");
    expect(await sent?.json()).toEqual({
      code: "ABCD-EFGH-JKMN",
      name: "Francesco",
      password: "una-password",
    });
  });

  it("does not ask the server when the passwords differ", async () => {
    const { user, server } = renderApp("/", newFranzPLAY);
    await user.type(await screen.findByLabelText("Codice di installazione"), "ABCD-EFGH-JKMN");
    await user.type(screen.getByLabelText("Nome"), "Francesco");
    await user.type(screen.getByLabelText("Password"), "una-password");
    await user.type(screen.getByLabelText("Ripeti la password"), "altra-password");
    await user.click(screen.getByRole("button", { name: "Crea e entra" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Le due password non sono uguali.");
    expect(server.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("explains a wrong code", async () => {
    const { user } = renderApp("/", {
      ...newFranzPLAY,
      "POST /api/setup": { status: 401, body: { error: "the setup code is not right" } },
    });
    await user.type(await screen.findByLabelText("Codice di installazione"), "SBAGLIATO");
    await user.type(screen.getByLabelText("Nome"), "Francesco");
    await user.type(screen.getByLabelText("Password"), "una-password");
    await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
    await user.click(screen.getByRole("button", { name: "Crea e entra" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Il codice di installazione non è giusto",
    );
  });
});

describe("checkSetup", () => {
  it.each([
    ["ab", "una-password", "una-password", "Il nome deve avere da 3 a 32 caratteri."],
    ["  ab  ", "una-password", "una-password", "Il nome deve avere da 3 a 32 caratteri."],
    ["Francesco", "corta", "corta", "La password deve avere da 8 a 128 caratteri."],
    ["Francesco", "una-password", "un-altra", "Le due password non sono uguali."],
    ["Niccolò", "èèèèèèèè", "èèèèèèèè", ""],
  ])("checks %s / %s", (name, password, confirm, want) => {
    expect(checkSetup(name, password, confirm)).toBe(want);
  });
});

describe("server down", () => {
  it("offers to try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let up = false;
    const { user } = renderApp("/", {
      "GET /api/me": () =>
        up
          ? new Response(JSON.stringify(testAccount))
          : new Response("bad gateway", { status: 502 }),
    });
    expect(
      await screen.findByRole("heading", { name: "Il server non risponde" }),
    ).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole("button", { name: "Riprova" }));
    expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
  });
});
