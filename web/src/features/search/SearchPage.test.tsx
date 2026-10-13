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

  it("shows the people found, each a link to their channel", async () => {
    const { server } = renderApp("/cerca?q=anna", {
      ...signedIn(),
      "GET /api/channels": {
        body: {
          people: [
            { id: 7, name: "Anna Rossi", avatar: 0 },
            { id: 9, name: "Annalisa", avatar: 2 },
          ],
        },
      },
      "GET /api/videos": {
        body: { videos: [videoJSON({ title: "Compleanno di Anna" })], total: 1 },
      },
    });
    const people = await screen.findByRole("region", { name: "Persone" });
    expect(within(people).getByRole("link", { name: "Anna Rossi" })).toHaveAttribute(
      "href",
      "/canale/7",
    );
    expect(within(people).getByRole("link", { name: "Annalisa" })).toHaveAttribute(
      "href",
      "/canale/9",
    );
    expect(screen.getByRole("heading", { name: "Video" })).toBeInTheDocument();
    const url = new URL(server.requests.find((r) => r.url.includes("/api/channels"))?.url ?? "");
    expect(url.searchParams.get("q")).toBe("anna");
  });

  it("shows only the people when no video is found", async () => {
    renderApp("/cerca?q=anna", {
      ...signedIn(),
      "GET /api/channels": { body: { people: [{ id: 7, name: "Anna", avatar: 0 }] } },
    });
    expect(await screen.findByRole("link", { name: "Anna" })).toBeInTheDocument();
    expect(screen.queryByText("Nessun video trovato per «anna».")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Video" })).not.toBeInTheDocument();
  });

  it("shows no people section when nobody is found", async () => {
    renderApp("/cerca?q=mare", {
      ...signedIn(),
      "GET /api/channels": { body: { people: [] } },
      "GET /api/videos": { body: { videos: [videoJSON({ title: "Mare" })], total: 1 } },
    });
    await screen.findByRole("list", { name: "Risultati per «mare»" });
    expect(screen.queryByRole("region", { name: "Persone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Video" })).not.toBeInTheDocument();
  });

  it("says when nothing is found", async () => {
    renderApp("/cerca?q=vulcano");
    expect(await screen.findByText("Nessun video trovato per «vulcano».")).toBeInTheDocument();
  });

  it("asks what to search when there is nothing to search", async () => {
    const { server } = renderApp("/cerca");
    expect(
      await screen.findByRole("heading", { name: "Cerca video e persone" }),
    ).toBeInTheDocument();
    expect(server.requests.some((r) => r.url.includes("/api/videos"))).toBe(false);
    expect(server.requests.some((r) => r.url.includes("/api/channels"))).toBe(false);
  });

  it("has its own search box, for phones", async () => {
    const { user } = renderApp("/cerca", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [videoJSON({ title: "Recita" })], total: 1 } },
    });
    await screen.findByRole("heading", { name: "Cerca video e persone" });
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
