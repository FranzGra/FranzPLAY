import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

describe("search page", () => {
  it("shows the videos found", async () => {
    const { server } = renderApp("/cerca?q=mare%20rimini", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [videoJSON({ title: "Mare a Rimini" })], total: 1 } },
    });
    const list = await screen.findByRole("list", { name: "Risultati per «mare rimini»" });
    expect(within(list).getByRole("heading", { name: "Mare a Rimini" })).toBeInTheDocument();
    const url = new URL(server.requests.find((r) => r.url.includes("/api/videos"))?.url ?? "");
    expect(url.searchParams.get("q")).toBe("mare rimini");
  });

  it("says when nothing is found", async () => {
    renderApp("/cerca?q=vulcano");
    expect(await screen.findByText("Nessun video trovato per «vulcano».")).toBeInTheDocument();
  });

  it("asks what to search when there is nothing to search", async () => {
    const { server } = renderApp("/cerca");
    expect(
      await screen.findByRole("heading", { name: "Cerca tra i tuoi video" }),
    ).toBeInTheDocument();
    expect(server.requests.some((r) => r.url.includes("/api/videos"))).toBe(false);
  });

  it("has its own search box, for phones", async () => {
    const { user } = renderApp("/cerca", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [videoJSON({ title: "Recita" })], total: 1 } },
    });
    await screen.findByRole("heading", { name: "Cerca tra i tuoi video" });
    const box = within(screen.getByRole("main")).getByRole("searchbox");
    await user.type(box, "recita{Enter}");
    expect(await screen.findByRole("list", { name: "Risultati per «recita»" })).toBeInTheDocument();
  });

  it("follows a new search made from the top bar", async () => {
    const { user } = renderApp("/cerca?q=mare");
    const page = within(await screen.findByRole("main"));
    expect(page.getByRole("searchbox")).toHaveValue("mare");
    const header = within(screen.getByRole("banner"));
    await user.type(header.getByRole("searchbox"), "lago{Enter}");
    expect(await screen.findByText("Nessun video trovato per «lago».")).toBeInTheDocument();
    expect(page.getByRole("searchbox")).toHaveValue("lago");
  });
});
