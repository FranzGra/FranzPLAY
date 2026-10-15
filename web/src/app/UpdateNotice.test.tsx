import { screen } from "@testing-library/react";
import { renderApp, signedIn, testAccount } from "../test/render";

const newer = {
  enabled: true,
  release: "1.4.0",
  commit: "abc1234",
  development: false,
  checkedAt: "2026-10-15T10:00:00Z",
  latest: "1.5.0",
  url: "https://github.com/FranzGra/FranzPLAY/releases/tag/v1.5.0",
  notes: "",
  newer: true,
};

describe("new version notice", () => {
  it("tells administrators once, with the command to copy", async () => {
    const { user } = renderApp("/", { ...signedIn(), "GET /api/updates": { body: newer } });
    const dialog = await screen.findByRole("dialog", { name: "È disponibile FranzPLAY 1.5.0" });
    expect(screen.getByRole("textbox", { name: "Comando per aggiornare" })).toHaveValue(
      "docker compose pull && docker compose up -d",
    );
    expect(screen.getByRole("link", { name: "Note di rilascio" })).toHaveAttribute(
      "href",
      newer.url,
    );
    expect(screen.getByRole("button", { name: "Chiudi" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(dialog).not.toBeInTheDocument();
    expect(window.localStorage.getItem("franzplay.update.seen")).toBe("1.5.0");

    // The pill in the side menu opens it again.
    await user.click(screen.getByRole("button", { name: "Nuova versione 1.5.0" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not open again for a version already closed", async () => {
    window.localStorage.setItem("franzplay.update.seen", "1.5.0");
    renderApp("/", { ...signedIn(), "GET /api/updates": { body: newer } });
    expect(await screen.findByRole("button", { name: "Nuova versione 1.5.0" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says nothing when the installed version is the latest", async () => {
    const { server } = renderApp("/", {
      ...signedIn(),
      "GET /api/updates": { body: { ...newer, release: "1.5.0", newer: false } },
    });
    await screen.findByRole("navigation", { name: "Menu principale" });
    await vi.waitFor(() =>
      expect(server.requests.some((r) => r.url.endsWith("/api/updates"))).toBe(true),
    );
    expect(screen.queryByRole("button", { name: /Nuova versione/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks nothing for people who are not administrators", async () => {
    const { server } = renderApp("/", {
      ...signedIn({ ...testAccount, role: "user" }),
      "GET /api/updates": { body: newer },
    });
    await screen.findByRole("navigation", { name: "Menu principale" });
    expect(server.requests.some((r) => r.url.endsWith("/api/updates"))).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
