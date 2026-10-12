import { screen, within } from "@testing-library/react";
import { mockFetchJSON, renderApp } from "../test/render";

describe("navigation", () => {
  it("shows the home page with an empty state", () => {
    renderApp("/");
    expect(screen.getByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
  });

  it("has exactly three tabs on the phone bar: Home, Playlist, Profilo", () => {
    renderApp("/");
    const tabbar = screen.getByRole("navigation", { name: "Menu del telefono" });
    const labels = within(tabbar)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(["Home", "Playlist", "Profilo"]);
  });

  it("marks the current page in the menus", async () => {
    mockFetchJSON({ status: "ok", version: "test" });
    const { user } = renderApp("/");
    const tabbar = screen.getByRole("navigation", { name: "Menu del telefono" });

    await user.click(within(tabbar).getByRole("link", { name: "Profilo" }));

    expect(within(tabbar).getByRole("link", { name: "Profilo" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabbar).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("shows an icon next to every page in the side menu", () => {
    renderApp("/");
    const menu = screen.getByRole("navigation", { name: "Menu principale" });
    const links = within(menu).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Cronologia",
      "Categorie",
      "Il mio canale",
      "Tutte le playlist",
    ]);
    for (const link of links) {
      expect(link.querySelector("svg")).not.toBeNull();
    }
  });

  it("has no channel subscriptions in the side menu", () => {
    renderApp("/");
    const menu = screen.getByRole("navigation", { name: "Menu principale" });
    expect(within(menu).queryByText(/iscrizion/i)).not.toBeInTheDocument();
  });

  it("shows a not-found page for unknown addresses", () => {
    renderApp("/does-not-exist");
    expect(screen.getByRole("heading", { name: "Pagina non trovata" })).toBeInTheDocument();
  });
});

describe("search", () => {
  it("goes to the search page with the typed text", async () => {
    const { user } = renderApp("/");
    await user.type(screen.getByRole("searchbox"), "  vacanze  {Enter}");
    expect(screen.getByText("Nessun video trovato per «vacanze».")).toBeInTheDocument();
  });

  it("does nothing when the search box is empty", async () => {
    const { user } = renderApp("/");
    await user.type(screen.getByRole("searchbox"), "   {Enter}");
    expect(screen.getByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
  });
});
