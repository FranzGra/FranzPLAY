import { screen } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

const status = {
  enabled: true,
  release: "",
  commit: "1c57e51",
  development: true,
  checkedAt: "2026-10-15T10:00:00Z",
  latest: "1.5.0",
  url: "https://github.com/FranzGra/FranzPLAY/releases/tag/v1.5.0",
  notes: "",
  newer: false,
};

describe("update check setting", () => {
  it("shows the versions and turns the check off", async () => {
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "GET /api/updates": { body: status },
      "PUT /api/updates": { body: { ...status, enabled: false, checkedAt: null, latest: "" } },
    });
    const toggle = await screen.findByRole("switch", {
      name: "Controlla automaticamente le nuove versioni",
    });
    expect(toggle).toBeChecked();
    expect(screen.getByText("versione di sviluppo (1c57e51)")).toBeInTheDocument();
    expect(screen.getByText("1.5.0")).toBeInTheDocument();
    expect(screen.getByText(/non propone aggiornamenti/)).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    const put = server.requests.find((r) => r.method === "PUT" && r.url.endsWith("/api/updates"));
    expect(await put?.json()).toEqual({ enabled: false });
    expect(screen.queryByText(/Ultimo controllo/)).not.toBeInTheDocument();
  });
});
