import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

const waiting = {
  id: 1,
  note: "Nonna Maria",
  canUpload: false,
  createdBy: "Paolo",
  createdAt: "2026-10-12T10:00:00Z",
  expiresAt: "2026-10-19T10:00:00Z",
  status: "waiting",
  usedBy: "",
};
const used = { ...waiting, id: 2, note: "", status: "used", usedBy: "Giulia", canUpload: true };
const expired = { ...waiting, id: 3, note: "Marco", status: "expired" };

describe("invites page", () => {
  it("lists the invites and where each one is", async () => {
    renderApp("/admin/inviti", {
      ...signedIn(),
      "GET /api/invites": { body: [waiting, used, expired] },
    });
    const list = await screen.findByRole("list", { name: "Inviti" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const [first, second, third] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(first).toHaveTextContent("Nonna Maria");
    expect(first).toHaveTextContent("Aspetta · funziona fino al 19 ottobre 2026");
    expect(within(first).getByRole("button", { name: /Annulla l'invito/ })).toBeInTheDocument();
    expect(second).toHaveTextContent("Invito senza nome");
    expect(second).toHaveTextContent("Usato da Giulia · potrà caricare video");
    expect(third).toHaveTextContent("Scaduto il 19 ottobre 2026, senza essere usato");
    expect(within(third).getByRole("button", { name: /Togli dall'elenco/ })).toBeInTheDocument();
  });

  it("explains what will appear when there is none", async () => {
    renderApp("/admin/inviti", { ...signedIn(), "GET /api/invites": { body: [] } });
    expect(await screen.findByRole("heading", { name: "Nessun invito" })).toBeInTheDocument();
  });

  it("makes an invite and shows its link once", async () => {
    const { user, server } = renderApp("/admin/inviti", {
      ...signedIn(),
      "GET /api/invites": { body: [] },
      "POST /api/invites": { status: 201, body: { ...waiting, id: 9, code: "codice-segreto" } },
    });
    await user.click(await screen.findByRole("button", { name: /Crea un invito/ }));
    const form = screen.getByRole("form", { name: "Nuovo invito" });
    await user.type(within(form).getByLabelText(/Per chi è/), "Nonna Maria");
    await user.click(within(form).getByRole("checkbox", { name: "Potrà caricare video" }));
    await user.click(within(form).getByRole("button", { name: "Crea il link" }));

    const panel = await screen.findByRole("region", { name: "Link dell'invito" });
    expect(within(panel).getByRole("heading")).toHaveTextContent("Il link per Nonna Maria");
    expect(within(panel).getByLabelText("Mandalo a chi vuoi invitare")).toHaveValue(
      `${window.location.origin}/invito#codice-segreto`,
    );
    expect(await server.requests.at(-1)?.json()).toEqual({ note: "Nonna Maria", canUpload: true });
    expect(screen.getByRole("list", { name: "Inviti" })).toHaveTextContent("Nonna Maria");

    await user.click(within(panel).getByRole("button", { name: "Fatto" }));
    expect(screen.queryByRole("region", { name: "Link dell'invito" })).not.toBeInTheDocument();
    expect(screen.queryByText(/codice-segreto/)).not.toBeInTheDocument();
  });

  it("cancels an invite", async () => {
    const { user, server } = renderApp("/admin/inviti", {
      ...signedIn(),
      "GET /api/invites": { body: [waiting] },
      "DELETE /api/invites/1": { status: 204 },
    });
    await user.click(await screen.findByRole("button", { name: /Annulla l'invito/ }));
    expect(await screen.findByRole("heading", { name: "Nessun invito" })).toBeInTheDocument();
    expect(server.requests.at(-1)?.method).toBe("DELETE");
  });
});
