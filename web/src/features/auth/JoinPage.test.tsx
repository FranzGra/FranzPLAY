import { screen } from "@testing-library/react";
import { emptyLibrary, renderApp, signedIn, testAccount } from "../../test/render";

const signedOut = {
  ...emptyLibrary,
  "GET /api/me": { status: 401, body: { error: "login required" } },
  "GET /api/setup": { body: { needed: false, codeNeeded: false, openRegistration: false } },
};

describe("join page", () => {
  it("creates the account of who opens the link, and lets them in", async () => {
    const { user, server } = renderApp("/invito#codice-segreto", {
      ...signedOut,
      "POST /api/join/check": { status: 204 },
      "POST /api/join": {
        status: 201,
        body: {
          id: 5,
          name: "Maria",
          role: "user",
          canUpload: false,
          uploadQuota: 10737418240,
          accentColor: "",
          avatar: 0,
        },
      },
    });
    expect(
      await screen.findByRole("heading", { name: "Sei stato invitato in FranzPLAY" }),
    ).toBeInTheDocument();
    const check = server.requests.find((r) => r.url.endsWith("/api/join/check"));
    expect(await check?.json()).toEqual({ code: "codice-segreto" });

    await user.type(screen.getByLabelText("Nome"), "Maria");
    await user.type(screen.getByLabelText("Password"), "password-di-maria");
    await user.type(screen.getByLabelText("Ripeti la password"), "un'altra");
    await user.click(screen.getByRole("button", { name: "Crea e entra" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Le due password non sono uguali.");

    await user.clear(screen.getByLabelText("Ripeti la password"));
    await user.type(screen.getByLabelText("Ripeti la password"), "password-di-maria");
    await user.click(screen.getByRole("button", { name: "Crea e entra" }));
    expect(await screen.findByRole("navigation", { name: "Menu principale" })).toBeInTheDocument();
    expect(await server.requests.find((r) => r.url.endsWith("/api/join"))?.json()).toEqual({
      code: "codice-segreto",
      name: "Maria",
      method: "password",
      password: "password-di-maria",
    });
  });

  it("says when the name is taken", async () => {
    const { user } = renderApp("/invito#codice", {
      ...signedOut,
      "POST /api/join/check": { status: 204 },
      "POST /api/join": { status: 409, body: { error: "this name is already used" } },
    });
    await user.type(await screen.findByLabelText("Nome"), "Paolo");
    await user.type(screen.getByLabelText("Password"), "una-password");
    await user.type(screen.getByLabelText("Ripeti la password"), "una-password");
    await user.click(screen.getByRole("button", { name: "Crea e entra" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "C'è già una persona con questo nome",
    );
  });

  it("explains a link that no longer works", async () => {
    renderApp("/invito#vecchio", {
      ...signedOut,
      "POST /api/join/check": { status: 410, body: { error: "gone" } },
    });
    expect(
      await screen.findByRole("heading", { name: "Questo invito non funziona più" }),
    ).toBeInTheDocument();
  });

  it("explains a link without its code", async () => {
    renderApp("/invito", signedOut);
    expect(
      await screen.findByRole("heading", { name: "Questo invito non funziona più" }),
    ).toBeInTheDocument();
  });

  it("does not let someone already inside use the link", async () => {
    renderApp("/invito#codice", { ...signedIn(), "POST /api/join/check": { status: 204 } });
    expect(await screen.findByRole("heading", { name: "Sei già dentro" })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(testAccount.name))).toBeInTheDocument();
    expect(screen.queryByLabelText("Nome")).not.toBeInTheDocument();
  });
});
