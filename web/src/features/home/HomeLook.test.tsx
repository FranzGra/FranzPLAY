import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { parseHomeLayout } from "../../api/home";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
import { VideoRow } from "../videos/VideoRow";
import { cardsPerLine, cardWidth, lookStyle, SectionsContext } from "./look";

const look = { columns: 0, size: 3, sections: "one" };

describe("the look of the Home", () => {
  it("turns the choices into the sizes of the grid", () => {
    expect(cardWidth(1)).toBe(180);
    expect(cardWidth(3)).toBe(260);
    expect(cardWidth(5)).toBe(400);
    // As many as fit, with 20px between them; never fewer than one.
    expect(cardsPerLine(1200, 3)).toBe(4);
    expect(cardsPerLine(1200, 1)).toBe(6);
    expect(cardsPerLine(1200, 5)).toBe(2);
    expect(cardsPerLine(864, 3)).toBe(3);
    expect(cardsPerLine(100, 5)).toBe(1);
    expect(lookStyle({ columns: 0, size: 4, sections: "one" })).toEqual({
      "--home-grid": "repeat(auto-fill, minmax(320px, 1fr))",
      "--home-card": "320px",
    });
    expect(lookStyle({ columns: 4, size: 1, sections: "scroll" })).toEqual({
      "--home-grid": "repeat(4, minmax(0, 1fr))",
      "--home-card": "calc((100% - 60px) / 4)",
    });
  });

  it("checks the look the server sends", () => {
    const ok = parseHomeLayout({ closed: [], look: { columns: 6, size: 5, sections: "scroll" } });
    expect(ok.look).toEqual({ columns: 6, size: 5, sections: "scroll" });
    for (const bad of [
      undefined,
      { columns: 1, size: 3, sections: "one" },
      { columns: 3, size: 0, sections: "one" },
      { columns: 3, size: 3, sections: "all" },
    ]) {
      expect(() => parseHomeLayout({ closed: [], look: bad })).toThrow();
    }
  });

  it("lets the person choose the cards and keeps the choice on the server", async () => {
    const { user, server } = renderApp("/", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [videoJSON()], total: 1 } },
      "PUT /api/home/look": { body: { closed: [], look } },
    });
    await user.click(await screen.findByRole("button", { name: "Personalizza" }));
    const panel = screen.getByRole("region", { name: "Personalizza la Home" });

    await user.click(within(panel).getByRole("button", { name: "4" }));
    expect(within(panel).getByRole("button", { name: "4" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(panel).getByRole("button", { name: "Due righe" }));
    // The grid follows at once.
    const grid = screen.getByRole("list", { name: "Tutti i video" });
    const page = grid.closest<HTMLElement>("[style]");
    expect(page?.style.getPropertyValue("--home-grid")).toBe("repeat(4, minmax(0, 1fr))");

    // The server gets only the last choice, a moment later.
    await waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
    const puts = server.requests.filter((r) => r.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(await puts[0]?.clone().json()).toEqual({ columns: 4, size: 3, sections: "two" });
  });

  it("lets the size decide only in Auto, and puts it aside with a fixed number", async () => {
    const { user } = renderApp("/", {
      ...signedIn(),
      "GET /api/home": { body: { closed: [], look: { columns: 5, size: 3, sections: "one" } } },
      "GET /api/videos": { body: { videos: [videoJSON()], total: 1 } },
      "PUT /api/home/look": { body: { closed: [], look } },
    });
    await user.click(await screen.findByRole("button", { name: "Personalizza" }));
    const panel = screen.getByRole("region", { name: "Personalizza la Home" });
    // A fixed number: no slider, and a word on why.
    expect(within(panel).queryByRole("slider")).not.toBeInTheDocument();
    expect(panel).toHaveTextContent("Con un numero fisso la grandezza si adatta da sola.");

    // Auto brings the slider back; moving it keeps Auto.
    await user.click(within(panel).getByRole("button", { name: "Auto" }));
    const slider = within(panel).getByRole("slider", { name: "Grandezza delle card" });
    fireEvent.change(slider, { target: { value: "4" } });
    expect(slider).toHaveValue("4");
    expect(within(panel).getByRole("button", { name: "Auto" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const grid = screen.getByRole("list", { name: "Tutti i video" });
    const page = grid.closest<HTMLElement>("[style]");
    expect(page?.style.getPropertyValue("--home-grid")).toBe(
      "repeat(auto-fill, minmax(320px, 1fr))",
    );

    // Choosing a number again keeps the size for the next Auto.
    await user.click(within(panel).getByRole("button", { name: "3" }));
    expect(within(panel).queryByRole("slider")).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Auto" }));
    expect(within(panel).getByRole("slider")).toHaveValue("4");

    await user.click(within(panel).getByRole("button", { name: "Torna come prima" }));
    expect(within(panel).getByRole("slider")).toHaveValue("3");
    expect(within(panel).getByRole("button", { name: "Una riga" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens the panel on the side and closes it with the X, Esc and Personalizza", async () => {
    const { user } = renderApp("/", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [videoJSON()], total: 1 } },
    });
    const button = await screen.findByRole("button", { name: "Personalizza" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Personalizza la Home" })).not.toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Personalizza la Home" });
    expect(panel).toHaveAttribute("data-side-panel", "open");
    // The Home stays there beside it.
    expect(screen.getByRole("list", { name: "Tutti i video" })).toBeInTheDocument();
    expect(panel).toHaveFocus();

    await user.click(within(panel).getByRole("button", { name: "Chiudi" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Personalizza la Home" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await user.click(button);
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();

    await user.click(button);
    expect(screen.getByRole("region", { name: "Personalizza la Home" })).toBeInTheDocument();
    await user.click(button);
    expect(screen.queryByRole("region", { name: "Personalizza la Home" })).not.toBeInTheDocument();
  });

  it("has nothing to choose on a phone", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query !== "(min-width: 600px)" }));
    renderApp("/", signedIn());
    expect(await screen.findByRole("heading", { name: "Esplora la libreria" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Personalizza" })).not.toBeInTheDocument();
  });
});

describe("a section of the Home", () => {
  function section(sections: "one" | "two" | "scroll", columns: string) {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      if (el.tagName === "UL") {
        Object.defineProperty(style, "gridTemplateColumns", { value: columns });
      }
      return style;
    });
    render(
      <MemoryRouter>
        <SectionsContext.Provider value={sections}>
          <VideoRow title="Ultimi arrivati">
            {["uno", "due", "tre", "quattro", "cinque"].map((n) => (
              <li key={n}>{n}</li>
            ))}
          </VideoRow>
        </SectionsContext.Provider>
      </MemoryRouter>,
    );
    return screen.getByRole("list");
  }

  it("shows one line of cards, and all of them on request", async () => {
    const list = section("one", "200px 200px");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const all = screen.getByRole("button", { name: "Mostra tutti (5)" });
    act(() => all.click());
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Mostra meno" })).toBeInTheDocument();
  });

  it("shows two lines when asked", () => {
    const list = section("two", "200px 200px");
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
  });

  it("shows every card in a line that scrolls", () => {
    const list = section("scroll", "200px 200px");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Mostra tutti/ })).not.toBeInTheDocument();
  });
});
