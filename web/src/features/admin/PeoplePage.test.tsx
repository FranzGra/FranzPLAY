import { screen, within } from "@testing-library/react";
import { renderApp, signedIn, testAccount } from "../../test/render";

const giulia = { id: 2, name: "Giulia", role: "user", canUpload: false };

function people(extra: Record<string, unknown> = {}) {
  return {
    ...signedIn(),
    "GET /api/users": { body: [testAccount, giulia] },
    ...extra,
  };
}

async function rowOf(name: string) {
  const list = await screen.findByRole("list", { name: "Persone" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByText(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("people page", () => {
  it("opens from the administration address", async () => {
    renderApp("/admin", people());
    expect(await screen.findByRole("heading", { name: "Amministrazione" })).toBeInTheDocument();
    const me = await rowOf("Francesco");
    const sections = screen.getByRole("navigation", { name: "Sezioni dell'amministrazione" });
    expect(within(sections).getByRole("link", { name: "Persone" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(me).getByText("(tu)")).toBeInTheDocument();
    // Nobody can remove themselves or stop being administrator from here.
    expect(within(me).queryByRole("button", { name: /Elimina/ })).not.toBeInTheDocument();
    expect(within(me).getByRole("checkbox", { name: "Amministratore" })).toBeDisabled();
  });

  it("is closed to normal users", async () => {
    renderApp("/admin/persone", signedIn({ ...testAccount, role: "user" }));
    expect(
      await screen.findByRole("heading", { name: "Solo per l'amministratore" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Persone" })).not.toBeInTheDocument();
  });

  it("shows the administration in the side menu only to the administrator", async () => {
    renderApp("/", signedIn({ ...testAccount, role: "user" }));
    const menu = await screen.findByRole("navigation", { name: "Menu principale" });
    expect(within(menu).queryByRole("link", { name: /Amministrazione/ })).not.toBeInTheDocument();
  });

  it("adds a person", async () => {
    const { user, server } = renderApp(
      "/admin/persone",
      people({
        "POST /api/users": {
          status: 201,
          body: { id: 3, name: "Anna", role: "user", canUpload: true },
        },
      }),
    );
    await user.click(await screen.findByRole("button", { name: /Aggiungi una persona/ }));
    const form = screen.getByRole("form", { name: "Nuova persona" });
    await user.type(within(form).getByLabelText("Nome"), "Anna");
    await user.type(within(form).getByLabelText("Password"), "corta");
    await user.click(within(form).getByRole("button", { name: "Aggiungi" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("da 8 a 128 caratteri");

    await user.type(within(form).getByLabelText("Password"), "-ma-giusta");
    await user.click(within(form).getByRole("checkbox", { name: "Può caricare video" }));
    await user.click(within(form).getByRole("button", { name: "Aggiungi" }));
    expect(await rowOf("Anna")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nuova persona" })).not.toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({
      name: "Anna",
      password: "corta-ma-giusta",
      role: "user",
      canUpload: true,
    });
  });

  it("says when the name is taken", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp(
      "/admin/persone",
      people({ "POST /api/users": { status: 409, body: { error: "this name is already used" } } }),
    );
    await user.click(await screen.findByRole("button", { name: /Aggiungi una persona/ }));
    await user.type(screen.getByLabelText("Nome"), "giulia");
    await user.type(screen.getByLabelText("Password"), "una-password");
    await user.click(screen.getByRole("button", { name: "Aggiungi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "C'è già una persona con questo nome.",
    );
  });

  it("changes what a person may do", async () => {
    const { user, server } = renderApp(
      "/admin/persone",
      people({ "PUT /api/users/2": { body: { ...giulia, canUpload: true } } }),
    );
    const row = await rowOf("Giulia");
    await user.click(within(row).getByRole("checkbox", { name: "Può caricare video" }));
    expect(await within(row).findByText(/carica video$/)).toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Può caricare video" })).toBeChecked();
    expect(await server.requests.at(-1)?.json()).toEqual({ role: "user", canUpload: true });
  });

  it("says the last administrator must stay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp(
      "/admin/persone",
      people({
        "GET /api/users": { body: [testAccount, { ...giulia, role: "admin" }] },
        "PUT /api/users/2": {
          status: 409,
          body: { error: "the last administrator cannot be removed" },
        },
      }),
    );
    const row = await rowOf("Giulia");
    await user.click(within(row).getByRole("checkbox", { name: "Amministratore" }));
    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Deve restare almeno un amministratore.",
    );
    expect(within(row).getByRole("checkbox", { name: "Amministratore" })).toBeChecked();
  });

  it("gives a new password", async () => {
    const { user, server } = renderApp(
      "/admin/persone",
      people({ "PUT /api/users/2/password": { status: 204 } }),
    );
    const row = await rowOf("Giulia");
    await user.click(within(row).getByRole("button", { name: "Nuova password" }));
    await user.type(within(row).getByLabelText("Nuova password per Giulia"), "nuova-password");
    await user.click(within(row).getByRole("button", { name: "Salva" }));
    expect(await within(row).findByRole("status")).toHaveTextContent("Password cambiata");
    expect(await server.requests.at(-1)?.json()).toEqual({ password: "nuova-password" });
  });

  it("removes a person after asking", async () => {
    const { user, server } = renderApp(
      "/admin/persone",
      people({ "DELETE /api/users/2": { status: 204 } }),
    );
    const row = await rowOf("Giulia");
    await user.click(within(row).getByRole("button", { name: /Elimina/ }));
    expect(within(row).getByText(/Non si può annullare/)).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Sì, elimina" }));
    const list = screen.getByRole("list", { name: "Persone" });
    await vi.waitFor(() => expect(within(list).queryByText("Giulia")).not.toBeInTheDocument());
    expect(server.requests.at(-1)?.method).toBe("DELETE");
  });
});
