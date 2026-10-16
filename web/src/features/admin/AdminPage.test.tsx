import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";
import { groups } from "./AdminPage";

// narrow makes the window as wide as a phone or a tablet.
function narrow() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: !query.includes("min-width: 1180px"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("administration frame", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("on a wide screen keeps the menu, by group, beside the open page", async () => {
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
    expect(screen.getByRole("heading", { level: 2, name: "Sito" })).toBeInTheDocument();
  });

  it("on a phone shows the menu as a page, with a line on each section", async () => {
    narrow();
    const { user } = renderApp("/admin", signedIn());
    const menu = await screen.findByRole("navigation", { name: "Sezioni dell'amministrazione" });
    expect(within(menu).getByText("Link per far entrare qualcuno")).toBeInTheDocument();

    await user.click(within(menu).getByRole("link", { name: /^Sito/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Sito" })).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Sezioni dell'amministrazione" }),
    ).not.toBeInTheDocument();

    // The way back sits above the page, not in the side menu of the site.
    const back = screen
      .getAllByRole("link", { name: "Amministrazione" })
      .find((link) => !link.closest("nav"));
    await user.click(back as HTMLElement);
    expect(
      await screen.findByRole("navigation", { name: "Sezioni dell'amministrazione" }),
    ).toBeInTheDocument();
  });
});
