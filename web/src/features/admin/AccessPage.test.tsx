import { screen, waitFor, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

function entry(id: number, name: string, outcome: string) {
  return { id, at: "2026-10-12T10:00:00Z", name, address: "192.168.1.20", outcome };
}

describe("access log page", () => {
  it("lists every try to log in, and searches it", async () => {
    const { user, server } = renderApp("/admin/accessi", {
      ...signedIn(),
      "GET /api/logins": (request) => {
        const q = new URL(request.url).searchParams;
        const all = [
          entry(3, "Giulia", "entered"),
          entry(2, "Nessuno", "wrong_password"),
          entry(1, "Admin", "locked"),
        ];
        const shown = all.filter(
          (l) =>
            (!q.get("q") || l.name.toLowerCase().includes(String(q.get("q")).toLowerCase())) &&
            (q.get("failed") !== "1" || l.outcome !== "entered"),
        );
        return new Response(JSON.stringify({ logins: shown, more: false }));
      },
    });
    const list = await screen.findByRole("list", { name: "Accessi" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Giulia");
    expect(rows[0]).toHaveTextContent("da 192.168.1.20");
    expect(rows[0]).toHaveTextContent("Entrato");
    expect(rows[1]).toHaveTextContent("Accesso sbagliato");
    expect(rows[2]).toHaveTextContent("Bloccato: troppi tentativi");

    await user.click(screen.getByRole("checkbox", { name: "Solo tentativi sbagliati" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("list", { name: "Accessi" })).getAllByRole("listitem"),
      ).toHaveLength(2),
    );
    expect(server.requests.at(-1)?.url).toContain("failed=1");

    await user.type(screen.getByLabelText("Cerca un nome o un indirizzo"), "zzz");
    expect(
      await screen.findByText("Nessun accesso trovato", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("shows older entries on request", async () => {
    const { user } = renderApp("/admin/accessi", {
      ...signedIn(),
      "GET /api/logins": (request) => {
        const before = new URL(request.url).searchParams.get("before");
        const page = before
          ? { logins: [entry(1, "Prima", "entered")], more: false }
          : { logins: [entry(2, "Dopo", "entered")], more: true };
        return new Response(JSON.stringify(page));
      },
    });
    await user.click(await screen.findByRole("button", { name: "Mostra altri" }));
    expect(await screen.findByText("Prima")).toBeInTheDocument();
    expect(screen.getByText("Dopo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mostra altri" })).not.toBeInTheDocument();
  });

  it("explains an empty log", async () => {
    renderApp("/admin/accessi", {
      ...signedIn(),
      "GET /api/logins": { body: { logins: [], more: false } },
    });
    expect(await screen.findByText("Ancora nessun accesso")).toBeInTheDocument();
  });
});
