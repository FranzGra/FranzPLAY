import { fireEvent, screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";
import { groups } from "./AdminPage";

// narrow makes the window as wide as a phone.
function narrow() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: !query.includes("min-width"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

// goTo is the window of "Vai a…" (jsdom does not open a dialog for real).
function goTo() {
  const dialog = document.querySelector<HTMLElement>("dialog[aria-label='Vai a una sezione']");
  if (!dialog) throw new Error("Vai a… is closed");
  return dialog;
}

describe("administration console", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens on Riepilogo when no section is asked", async () => {
    renderApp("/admin", signedIn());
    const crumb = await screen.findByRole("list", { name: "Sei qui" });
    expect(within(crumb).getByText("Riepilogo")).toHaveAttribute("aria-current", "page");
  });

  it("on a computer keeps the menu, by group, beside the open page", async () => {
    renderApp("/admin/sito", signedIn());
    const menu = await screen.findByRole("navigation", { name: "Sezioni dell'amministrazione" });
    for (const title of ["Persone", "Contenuti", "Sistema"]) {
      expect(within(menu).getByText(title, { selector: "p" })).toBeInTheDocument();
    }
    const links = within(menu).getAllByRole("link");
    expect(links).toHaveLength(groups.flatMap((g) => g.sections).length);
    for (const link of links) {
      expect(link.querySelector("svg")).not.toBeNull();
    }
    expect(within(menu).getByRole("link", { name: "Sito" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Sito" })).toBeInTheDocument();
    // The path on top says where the page is, and the app is one click away.
    const crumb = screen.getByRole("list", { name: "Sei qui" });
    expect(crumb).toHaveTextContent("Sistema");
    expect(within(crumb).getByText("Sito")).toHaveAttribute("aria-current", "page");
    const rail = screen.getByRole("navigation", { name: "Menu dell'app" });
    expect(within(rail).getAllByRole("link", { name: "Home" }).length).toBeGreaterThan(0);
    // What is at work is always in sight, in the bar and under the menu.
    expect(screen.getAllByRole("link", { name: /Tutto fermo/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Tutto fermo" })).toBeInTheDocument();
  });

  it("shows how far the work is in the menu and on top", async () => {
    const job = {
      id: 5,
      kind: "transcribe",
      videoId: 7,
      title: "Neve",
      attempts: 1,
      error: "",
      at: "2026-10-29T10:00:00Z",
      state: "running",
      seconds: 60,
      stage: "transcribe",
      progress: 30,
    };
    const model = {
      ...job,
      id: 0,
      videoId: 0,
      kind: "model",
      title: "base",
      progress: null,
      doneSeconds: 70 << 20,
      totalSeconds: 100 << 20,
    };
    renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/jobs": {
        body: {
          waiting: 0,
          retrying: 0,
          done: 0,
          running: job,
          failed: [],
          failedTotal: 0,
          kinds: [],
          active: [job, model],
          queue: [],
          recent: [],
          recentTotal: 0,
          counts: [],
        },
      },
    });
    const card = await screen.findByRole("region", { name: "Al lavoro" });
    expect(within(card).getByRole("progressbar", { name: "Trascrizione di Neve" })).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
    expect(within(card).getByText("30%")).toBeInTheDocument();
    expect(within(card).getByText("70%")).toBeInTheDocument();
    // The pill on top: two things at work, on average halfway.
    const [pill] = screen.getAllByRole("link", { name: /2 lavori in corso/ });
    if (!pill) throw new Error("no pill");
    expect(pill).toHaveTextContent("· 50%");
    expect(within(pill).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("finds a section from Vai a…, also with Ctrl K", async () => {
    const { user } = renderApp("/admin/riepilogo", signedIn());
    await user.click(await screen.findByRole("button", { name: /Vai a…/ }));
    let dialog = goTo();
    const field = within(dialog).getByRole("combobox", { hidden: true });
    fireEvent.change(field, { target: { value: "sottot" } });
    const options = within(dialog).getAllByRole("option", { hidden: true });
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Sottotitoli");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sottotitoli" }),
    ).toBeInTheDocument();
    expect(document.querySelector("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await vi.waitFor(() => expect(document.querySelector("dialog")).not.toBeNull());
    dialog = goTo();
    const again = within(dialog).getByRole("combobox", { hidden: true });
    fireEvent.change(again, { target: { value: "nulla di simile" } });
    expect(within(dialog).getByText("Nessuna sezione con queste parole.")).toBeInTheDocument();
    fireEvent.keyDown(again, { key: "Escape" });
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("on a phone shows the sections as chips over the page", async () => {
    narrow();
    const { user } = renderApp("/admin/riepilogo", signedIn());
    const menu = await screen.findByRole("navigation", { name: "Sezioni dell'amministrazione" });
    expect(within(menu).getAllByRole("link")).toHaveLength(
      groups.flatMap((g) => g.sections).length,
    );
    expect(screen.queryByRole("button", { name: /Vai a…/ })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("link", { name: "Sito" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sito" })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Sito" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
