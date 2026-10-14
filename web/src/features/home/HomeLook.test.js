import { jsx as _jsx } from "react/jsx-runtime";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { parseHomeLayout } from "../../api/home";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
import { VideoRow } from "../videos/VideoRow";
import { cardWidth, lookStyle, SectionsContext } from "./look";
const look = { columns: 0, size: 3, sections: "one" };
describe("the look of the Home", () => {
    it("turns the choices into the sizes of the grid", () => {
        expect(cardWidth(1)).toBe(180);
        expect(cardWidth(3)).toBe(260);
        expect(cardWidth(5)).toBe(400);
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
        expect(within(panel).getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true");
        await user.click(within(panel).getByRole("button", { name: "Due righe" }));
        // The grid follows at once.
        const grid = screen.getByRole("list", { name: "Tutti i video" });
        const page = grid.closest("[style]");
        expect(page?.style.getPropertyValue("--home-grid")).toBe("repeat(4, minmax(0, 1fr))");
        // The server gets only the last choice, a moment later.
        await waitFor(() => expect(server.requests.some((r) => r.method === "PUT")).toBe(true));
        const puts = server.requests.filter((r) => r.method === "PUT");
        expect(puts).toHaveLength(1);
        expect(await puts[0]?.clone().json()).toEqual({ columns: 4, size: 3, sections: "two" });
    });
    it("lets the size decide the cards in a line when the slider moves", async () => {
        const { user } = renderApp("/", {
            ...signedIn(),
            "GET /api/home": { body: { closed: [], look: { columns: 5, size: 3, sections: "one" } } },
            "PUT /api/home/look": { body: { closed: [], look } },
        });
        await user.click(await screen.findByRole("button", { name: "Personalizza" }));
        const slider = screen.getByRole("slider", { name: "Grandezza delle card" });
        fireEvent.change(slider, { target: { value: "4" } });
        expect(slider).toHaveValue("4");
        expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
        await user.click(screen.getByRole("button", { name: "Torna come prima" }));
        expect(slider).toHaveValue("3");
        expect(screen.getByRole("button", { name: "Una riga" })).toHaveAttribute("aria-pressed", "true");
    });
    it("has nothing to choose on a phone", async () => {
        vi.stubGlobal("matchMedia", (query) => ({ matches: query !== "(min-width: 600px)" }));
        renderApp("/", signedIn());
        expect(await screen.findByRole("heading", { name: "Esplora la libreria" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Personalizza" })).not.toBeInTheDocument();
    });
});
describe("a section of the Home", () => {
    function section(sections, columns) {
        const real = window.getComputedStyle;
        vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
            const style = real(el, pseudo);
            if (el.tagName === "UL") {
                Object.defineProperty(style, "gridTemplateColumns", { value: columns });
            }
            return style;
        });
        render(_jsx(MemoryRouter, { children: _jsx(SectionsContext.Provider, { value: sections, children: _jsx(VideoRow, { title: "Ultimi arrivati", children: ["uno", "due", "tre", "quattro", "cinque"].map((n) => (_jsx("li", { children: n }, n))) }) }) }));
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
