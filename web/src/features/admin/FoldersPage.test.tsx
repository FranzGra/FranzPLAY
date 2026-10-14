import { act, screen, within } from "@testing-library/react";
import { type LastScan, parseLibraryOverview } from "../../api/library";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { renderApp, signedIn } from "../../test/render";
import { describeChanges, took } from "./FoldersPage";

function folder(overrides: Record<string, unknown> = {}) {
  return {
    path: "/media/video",
    videos: 120,
    missing: 0,
    problem: "",
    looksUnplugged: false,
    ...overrides,
  };
}

function scan(overrides: Record<string, unknown> = {}) {
  return {
    at: new Date(Date.now() - 2 * 60_000).toISOString(),
    seconds: 0.25,
    error: "",
    unchanged: 120,
    added: 0,
    moved: 0,
    updated: 0,
    restored: 0,
    missing: 0,
    duplicates: 0,
    forgotten: 0,
    problems: 0,
    ...overrides,
  };
}

function overview(overrides: Record<string, unknown> = {}) {
  return { scanning: false, interval: 60, lastScan: scan(), folders: [folder()], ...overrides };
}

describe("describeChanges", () => {
  const base = parseLibraryOverview(overview()).lastScan as LastScan;
  it.each([
    [{}, "nessun cambiamento"],
    [{ added: 1 }, "1 nuovo"],
    [{ added: 3, missing: 1, problems: 2 }, "3 nuovi · 1 non trovato · 2 problemi"],
  ])("%j", (changes, want) => {
    expect(describeChanges({ ...base, ...changes })).toBe(want);
  });
});

describe("took", () => {
  it.each([
    [0.02, "in meno di un secondo"],
    [1.2, "in un secondo"],
    [12.6, "in 13 secondi"],
  ])("%d", (seconds, want) => {
    expect(took(seconds)).toBe(want);
  });
});

describe("folders page", () => {
  it("shows the folders and the last check", async () => {
    renderApp("/admin/cartelle", {
      ...signedIn(),
      "GET /api/library": {
        body: overview({
          folders: [folder(), folder({ path: "/media/famiglia", videos: 3, missing: 2 })],
          lastScan: scan({ added: 2 }),
        }),
      },
    });
    const list = await screen.findByRole("list", { name: "Cartelle video" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("/media/video");
    expect(rows[0]).toHaveTextContent("120 video");
    expect(rows[0]).toHaveTextContent("Tutto a posto");
    expect(rows[1]).toHaveTextContent("3 video · 2 non trovati");
    expect(rows[1]).toHaveTextContent("per 30 giorni");
    const last = screen.getByRole("region", { name: "Ultimo controllo" });
    expect(last).toHaveTextContent("2 minuti fa, in meno di un secondo");
    expect(last).toHaveTextContent("2 nuovi");
    expect(screen.getByText(/ogni minuto/)).toBeInTheDocument();
  });

  it("warns about a folder that cannot be read or looks unplugged", async () => {
    renderApp("/admin/cartelle", {
      ...signedIn(),
      "GET /api/library": {
        body: overview({
          folders: [
            folder({ problem: "read library: open .: no such file or directory" }),
            folder({ path: "/media/usb", looksUnplugged: true }),
          ],
        }),
      },
    });
    const list = await screen.findByRole("list", { name: "Cartelle video" });
    const [broken, unplugged] = within(list).getAllByRole("listitem");
    expect(broken).toHaveTextContent("Non riesco a leggere tutta la cartella");
    expect(broken).toHaveTextContent("no such file or directory");
    expect(unplugged).toHaveTextContent("il disco è collegato?");
    expect(within(list).queryByText("Tutto a posto")).not.toBeInTheDocument();
  });

  it("explains how to add a folder when there is none", async () => {
    renderApp("/admin/cartelle", {
      ...signedIn(),
      "GET /api/library": { body: overview({ folders: [], lastScan: null }) },
    });
    expect(
      await screen.findByRole("heading", { name: "Nessuna cartella video" }),
    ).toBeInTheDocument();
  });

  it("checks now, and follows the check as it runs", async () => {
    stubEventSource();
    let library = overview();
    const { user, server } = renderApp("/admin/cartelle", {
      ...signedIn(),
      "GET /api/library": () => new Response(JSON.stringify(library)),
      "POST /api/library/scan": () => {
        library = overview({ scanning: true });
        return new Response(null, { status: 202 });
      },
    });
    await user.click(await screen.findByRole("button", { name: "Controlla adesso" }));
    expect(await screen.findByRole("button", { name: "Controllo in corso…" })).toBeDisabled();
    expect(server.requests.some((r) => r.method === "POST")).toBe(true);

    library = overview({ lastScan: scan({ at: new Date().toISOString(), added: 1 }) });
    act(() => FakeEventSource.last?.emit("scan"));
    expect(await screen.findByRole("button", { name: "Controlla adesso" })).toBeEnabled();
    expect(screen.getByRole("region", { name: "Ultimo controllo" })).toHaveTextContent("1 nuovo");
  });
});
