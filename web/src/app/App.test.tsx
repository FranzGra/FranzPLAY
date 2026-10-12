import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../test/render";

describe("navigation", () => {
  it("shows the home page with an empty state", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
  });

  it("has exactly three tabs on the phone bar: Home, Playlist, Profilo", async () => {
    renderApp("/");
    const tabbar = await screen.findByRole("navigation", { name: "Menu del telefono" });
    const labels = within(tabbar)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(["Home", "Playlist", "Profilo"]);
  });

  it("marks the current page in the menus", async () => {
    const { user } = renderApp("/");
    const tabbar = await screen.findByRole("navigation", { name: "Menu del telefono" });

    await user.click(within(tabbar).getByRole("link", { name: "Profilo" }));

    expect(within(tabbar).getByRole("link", { name: "Profilo" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabbar).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("shows an icon next to every page in the side menu", async () => {
    renderApp("/");
    const menu = await screen.findByRole("navigation", { name: "Menu principale" });
    const links = within(menu).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Cronologia",
      "Mi piace",
      "Condivisi con te",
      "Categorie",
      "Il mio canale",
      "Tutte le playlist",
      "Amministrazione", // the test account is the administrator
    ]);
    for (const link of links) {
      expect(link.querySelector("svg")).not.toBeNull();
    }
  });

  it("lists my playlists in the side menu", async () => {
    const list = (id: number, kind: string, name: string) => ({
      id,
      kind,
      name,
      owner: { id: 1, name: "Francesco" },
      public: false,
      videos: 0,
      cover: null,
      updatedAt: "2026-10-12T09:00:00Z",
    });
    renderApp("/", {
      ...signedIn(),
      "GET /api/playlists": { body: [list(1, "later", ""), list(2, "playlist", "Gite")] },
    });
    const menu = await screen.findByRole("navigation", { name: "Menu principale" });
    expect(await within(menu).findByRole("link", { name: "Gite" })).toHaveAttribute(
      "href",
      "/playlist/2",
    );
    expect(within(menu).getByRole("link", { name: "Guarda più tardi" })).toHaveAttribute(
      "href",
      "/playlist/1",
    );
  });

  it("shows my initial in the top bar, as on my profile", async () => {
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Il tuo profilo" })).toHaveTextContent("F");
  });

  it("has no channel subscriptions in the side menu", async () => {
    renderApp("/");
    const menu = await screen.findByRole("navigation", { name: "Menu principale" });
    expect(within(menu).queryByText(/iscrizion/i)).not.toBeInTheDocument();
  });

  it("shows a not-found page for unknown addresses", async () => {
    renderApp("/does-not-exist");
    expect(await screen.findByRole("heading", { name: "Pagina non trovata" })).toBeInTheDocument();
  });
});

describe("search", () => {
  it("goes to the search page with the typed text", async () => {
    const { user } = renderApp("/");
    await user.type(await screen.findByRole("searchbox"), "  vacanze  {Enter}");
    expect(screen.getByText("Nessun video trovato per «vacanze».")).toBeInTheDocument();
  });

  it("does nothing when the search box is empty", async () => {
    const { user } = renderApp("/");
    await user.type(await screen.findByRole("searchbox"), "   {Enter}");
    expect(screen.getByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
  });
});
