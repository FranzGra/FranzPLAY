import { screen, waitFor, within } from "@testing-library/react";
import { renderApp, signedIn, testAccount } from "../../test/render";

const giulia = {
  id: 2,
  name: "Giulia",
  role: "user",
  canUpload: false,
  uploadQuota: 10737418240,
  accentColor: "",
  avatar: 0,
  lastLogin: null,
};
const me = { ...testAccount, lastLogin: new Date(Date.now() - 3 * 3600_000).toISOString() };

function people(extra: Record<string, unknown> = {}) {
  return {
    ...signedIn(),
    "GET /api/users": { body: [me, giulia] },
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
  it("says when each person last entered", async () => {
    renderApp("/admin/persone", people());
    expect(await rowOf("Paolo")).toHaveTextContent("Ultimo accesso 3 ore fa");
    expect(await rowOf("Giulia")).toHaveTextContent("Non è ancora entrato con nome e password");
  });

  it("shows who I am and what I cannot do to myself", async () => {
    renderApp("/admin/persone", people());
    expect(await screen.findByRole("heading", { name: "Amministrazione" })).toBeInTheDocument();
    const me = await rowOf("Paolo");
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
          body: {
            id: 3,
            name: "Anna",
            role: "user",
            canUpload: true,
            uploadQuota: 10737418240,
            accentColor: "",
            avatar: 0,
          },
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
    expect(await within(row).findByText(/carica video, fino a 10 GB$/)).toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Può caricare video" })).toBeChecked();
    expect(await server.requests.at(-1)?.json()).toEqual({ role: "user", canUpload: true });
  });

  it("chooses how much space a person has for videos", async () => {
    const uploader = { ...giulia, canUpload: true };
    const { user, server } = renderApp("/admin/persone", {
      ...people(),
      "GET /api/users": { body: [me, uploader] },
      "PUT /api/users/2": { body: { ...uploader, uploadQuota: 50 * 1024 ** 3 } },
    });
    const row = await rowOf("Giulia");
    await user.click(within(row).getByRole("combobox", { name: "Spazio" }));
    await user.click(screen.getByRole("option", { name: "50 GB" }));
    expect(await within(row).findByText(/fino a 50 GB$/)).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({
      role: "user",
      canUpload: true,
      uploadQuota: 50 * 1024 ** 3,
    });
  });

  it("asks the space only of who can upload", async () => {
    renderApp("/admin/persone", people());
    const row = await rowOf("Giulia");
    expect(within(row).queryByRole("combobox", { name: "Spazio" })).not.toBeInTheDocument();
  });

  it("says the last administrator must stay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp(
      "/admin/persone",
      people({
        "GET /api/users": { body: [me, { ...giulia, role: "admin" }] },
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

  it("lets the administrator allow public links, off for a new person", async () => {
    let sent: unknown = null;
    const { user } = renderApp(
      "/admin/persone",
      people({
        "PUT /api/users/2": async (request: Request) => {
          sent = await request.json();
          return Response.json({ ...giulia, canSharePublic: true });
        },
      }),
    );
    const row = await rowOf("Giulia");
    const box = within(row).getByRole("checkbox", { name: "Può creare link pubblici" });
    expect(box).not.toBeChecked();
    await user.click(box);
    await waitFor(() =>
      expect(sent).toEqual({ role: "user", canUpload: false, canSharePublic: true }),
    );
    // An administrator always may: the box is ticked and locked.
    const mine = within(await rowOf("Paolo")).getByRole("checkbox", {
      name: "Può creare link pubblici",
    });
    expect(mine).toBeChecked();
    expect(mine).toBeDisabled();
  });

  it("says the links stop working when the permission goes away", async () => {
    const { user } = renderApp(
      "/admin/persone",
      people({
        "GET /api/users": { body: [me, { ...giulia, canSharePublic: true }] },
        "PUT /api/users/2": { body: { ...giulia, canSharePublic: false } },
      }),
    );
    const row = await rowOf("Giulia");
    await user.click(within(row).getByRole("checkbox", { name: "Può creare link pubblici" }));
    expect(
      await screen.findByText("I link pubblici creati da Giulia non funzionano più."),
    ).toBeInTheDocument();
  });
});
