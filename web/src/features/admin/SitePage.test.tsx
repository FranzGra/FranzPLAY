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
    expect(await server.requests.at(-1)?.json()).toEqual(saved);
    // The logo at the top and the color of the page follow.
    expect(screen.getByRole("link", { name: "CasaRossi" })).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe("#dc2626");
    expect(document.title).toBe("Amministrazione · CasaRossi");
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
    expect(await server.requests.at(-1)?.json()).toEqual({ open: true });

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
