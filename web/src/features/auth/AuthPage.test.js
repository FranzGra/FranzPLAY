import { screen, within } from "@testing-library/react";
import { emptyLibrary, renderApp, testAccount } from "../../test/render";
import { checkSetup } from "./AuthPage";
const signedOut = {
    ...emptyLibrary,
    "GET /api/me": { status: 401, body: { error: "login required" } },
    "GET /api/setup": { body: { needed: false, codeNeeded: false, openRegistration: false } },
};
const newFranzPLAY = {
    ...signedOut,
    "GET /api/setup": { body: { needed: true, codeNeeded: false, openRegistration: false } },
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
        await user.type(await screen.findByLabelText("Nome"), "Paolo");
        await user.type(screen.getByLabelText("Password"), "una-password");
        await user.click(screen.getByRole("button", { name: "Entra" }));
        // It stays on the page that was asked for.
        expect(await screen.findByRole("heading", { name: "Paolo" })).toBeInTheDocument();
        const sent = server.requests.find((r) => r.url.endsWith("/api/login"));
        expect(await sent?.json()).toEqual({ name: "Paolo", password: "una-password" });
    });
    it.each([
        [401, "Nome o password sbagliati."],
        [403, "arriva da un indirizzo diverso da quello del sito"],
        [429, "Troppe password sbagliate. Aspetta un minuto e riprova."],
        [500, "Qualcosa è andato storto sul server. Riprova tra poco."],
    ])("explains a %i answer", async (status, message) => {
        const { user } = renderApp("/", {
            ...signedOut,
            "POST /api/login": { status, body: { error: "refused" } },
        });
        await user.type(await screen.findByLabelText("Nome"), "Paolo");
        await user.type(screen.getByLabelText("Password"), "sbagliata");
        await user.click(screen.getByRole("button", { name: "Entra" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(message);
        expect(screen.getByRole("button", { name: "Entra" })).toBeEnabled();
    });
    it("goes back to the login when the session expires", async () => {
        let expired = false;
        const { user } = renderApp("/", {
            "GET /api/me": () => expired
                ? new Response(JSON.stringify({ error: "login required" }), { status: 401 })
                : new Response(JSON.stringify(testAccount)),
            "GET /api/setup": { body: { needed: false, codeNeeded: false, openRegistration: false } },
            "GET /api/health": () => new Response(JSON.stringify({ error: "login required" }), { status: 401 }),
        });
        expired = true;
        vi.spyOn(console, "error").mockImplementation(() => { });
        await user.click(await screen.findByRole("link", { name: "Profilo" }));
        expect(await screen.findByRole("heading", { name: "Accedi a FranzPLAY" })).toBeInTheDocument();
    });
});
// withSetupCode is a new FranzPLAY whose installer asked for the code in the log.
const withSetupCode = {
    ...signedOut,
    "GET /api/setup": { body: { needed: true, codeNeeded: true, openRegistration: false } },
};
describe("first setup", () => {
    it("creates the administrator without any code", async () => {
        const { user, server } = renderApp("/", {
            ...newFranzPLAY,
            "POST /api/setup": { status: 201, body: testAccount },
        });
        expect(await screen.findByRole("heading", { name: "Benvenuto in FranzPLAY" })).toBeInTheDocument();
        expect(screen.queryByLabelText("Codice di installazione")).not.toBeInTheDocument();
        expect(screen.queryByText(/setup_code/)).not.toBeInTheDocument();
        await user.type(screen.getByLabelText("Nome"), "Paolo");
        await user.type(screen.getByLabelText("Password"), "una-password");
        await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
        await user.click(screen.getByRole("button", { name: "Crea e entra" }));
        expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
        const sent = server.requests.find((r) => r.method === "POST");
        expect(await sent?.json()).toEqual({ code: "", name: "Paolo", password: "una-password" });
    });
    it("asks for the code when the installer turned it on", async () => {
        const { user, server } = renderApp("/", {
            ...withSetupCode,
            "POST /api/setup": { status: 201, body: testAccount },
        });
        expect(await screen.findByText(/setup_code/)).toBeInTheDocument();
        await user.type(screen.getByLabelText("Codice di installazione"), "ABCD-EFGH-JKMN");
        await user.type(screen.getByLabelText("Nome"), "Paolo");
        await user.type(screen.getByLabelText("Password"), "una-password");
        await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
        await user.click(screen.getByRole("button", { name: "Crea e entra" }));
        expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
        const sent = server.requests.find((r) => r.method === "POST");
        expect(await sent?.json()).toEqual({
            code: "ABCD-EFGH-JKMN",
            name: "Paolo",
            password: "una-password",
        });
    });
    it("names the site too, if the administrator wants", async () => {
        const chosen = { nameFirst: "Casa", nameSecond: "Rossi", color: "#dc2626" };
        const { user, server } = renderApp("/", {
            ...newFranzPLAY,
            "POST /api/setup": { status: 201, body: testAccount },
            "PUT /api/site": { body: chosen },
        });
        await user.type(await screen.findByLabelText("Nome"), "Paolo");
        await user.type(screen.getByLabelText("Password"), "una-password");
        await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
        const site = screen.getByRole("region", { name: "Il tuo sito" });
        await user.clear(within(site).getByLabelText("Prima parte del nome"));
        await user.type(within(site).getByLabelText("Prima parte del nome"), "Casa");
        await user.clear(within(site).getByLabelText("Seconda parte (nel colore)"));
        await user.type(within(site).getByLabelText("Seconda parte (nel colore)"), "Rossi");
        await user.click(within(site).getByRole("button", { name: "Rosso" }));
        await user.click(screen.getByRole("button", { name: "Crea e entra" }));
        expect(await screen.findByRole("link", { name: "CasaRossi" })).toBeInTheDocument();
        const sent = server.requests.find((r) => r.url.endsWith("/api/site") && r.method === "PUT");
        expect(await sent?.json()).toEqual(chosen);
    });
    it("does not ask the server when the passwords differ", async () => {
        const { user, server } = renderApp("/", newFranzPLAY);
        await user.type(await screen.findByLabelText("Nome"), "Paolo");
        await user.type(screen.getByLabelText("Password"), "una-password");
        await user.type(screen.getByLabelText("Ripeti la password"), "altra-password");
        await user.click(screen.getByRole("button", { name: "Crea e entra" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Le due password non sono uguali.");
        expect(server.requests.some((r) => r.method === "POST")).toBe(false);
    });
    it("explains a wrong code", async () => {
        const { user } = renderApp("/", {
            ...withSetupCode,
            "POST /api/setup": { status: 401, body: { error: "the setup code is not right" } },
        });
        await user.type(await screen.findByLabelText("Codice di installazione"), "SBAGLIATO");
        await user.type(screen.getByLabelText("Nome"), "Paolo");
        await user.type(screen.getByLabelText("Password"), "una-password");
        await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
        await user.click(screen.getByRole("button", { name: "Crea e entra" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Il codice di installazione non è giusto");
    });
});
describe("registering without an invite", () => {
    const open = {
        ...signedOut,
        "GET /api/setup": { body: { needed: false, codeNeeded: false, openRegistration: true } },
    };
    it("is not offered while the administrator keeps it closed", async () => {
        renderApp("/", signedOut);
        expect(await screen.findByRole("heading", { name: "Accedi a FranzPLAY" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Registrati" })).not.toBeInTheDocument();
    });
    it("creates my account and lets me in", async () => {
        const newcomer = {
            id: 7,
            name: "Giulia",
            role: "user",
            canUpload: false,
            uploadQuota: 10737418240,
            accentColor: "",
            avatar: 0,
        };
        const { user, server } = renderApp("/", {
            ...open,
            "POST /api/register": { status: 201, body: newcomer },
        });
        await user.click(await screen.findByRole("button", { name: "Registrati" }));
        expect(screen.getByRole("heading", { name: "Crea il tuo account" })).toBeInTheDocument();
        await user.type(screen.getByLabelText("Nome"), "Giulia");
        await user.type(screen.getByLabelText("Password"), "una-password");
        await user.type(screen.getByLabelText("Ripeti la password"), "altra-password");
        await user.click(screen.getByRole("button", { name: "Crea e entra" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Le due password non sono uguali.");
        await user.clear(screen.getByLabelText("Ripeti la password"));
        await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
        await user.click(screen.getByRole("button", { name: "Crea e entra" }));
        expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
        const sent = server.requests.find((r) => r.url.endsWith("/api/register"));
        expect(await sent?.json()).toEqual({ name: "Giulia", password: "una-password" });
    });
    it.each([
        [403, "La registrazione è chiusa"],
        [409, "Questo nome lo usa già un'altra persona"],
        [429, "Troppi account nuovi da questa rete"],
    ])("explains a %i answer", async (status, message) => {
        const { user } = renderApp("/", {
            ...open,
            "POST /api/register": { status, body: { error: "refused" } },
        });
        await user.click(await screen.findByRole("button", { name: "Registrati" }));
        await user.type(screen.getByLabelText("Nome"), "Giulia");
        await user.type(screen.getByLabelText("Password"), "una-password");
        await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
        await user.click(screen.getByRole("button", { name: "Crea e entra" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(message);
    });
    it("goes back to the login", async () => {
        const { user } = renderApp("/", open);
        await user.click(await screen.findByRole("button", { name: "Registrati" }));
        await user.click(screen.getByRole("button", { name: "Accedi" }));
        expect(screen.getByRole("heading", { name: "Accedi a FranzPLAY" })).toBeInTheDocument();
        expect(screen.queryByLabelText("Ripeti la password")).not.toBeInTheDocument();
    });
});
describe("checkSetup", () => {
    it.each([
        ["ab", "una-password", "una-password", "Il nome deve avere da 3 a 32 caratteri."],
        ["  ab  ", "una-password", "una-password", "Il nome deve avere da 3 a 32 caratteri."],
        ["Paolo", "corta", "corta", "La password deve avere da 8 a 128 caratteri."],
        ["Paolo", "una-password", "un-altra", "Le due password non sono uguali."],
        ["Niccolò", "èèèèèèèè", "èèèèèèèè", ""],
    ])("checks %s / %s", (name, password, confirm, want) => {
        expect(checkSetup(name, password, confirm)).toBe(want);
    });
});
describe("server down", () => {
    it("offers to try again", async () => {
        vi.spyOn(console, "error").mockImplementation(() => { });
        let up = false;
        const { user } = renderApp("/", {
            ...emptyLibrary,
            "GET /api/me": () => up
                ? new Response(JSON.stringify(testAccount))
                : new Response("bad gateway", { status: 502 }),
        });
        expect(await screen.findByRole("heading", { name: "Il server non risponde" })).toBeInTheDocument();
        up = true;
        await user.click(screen.getByRole("button", { name: "Riprova" }));
        expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
    });
});
