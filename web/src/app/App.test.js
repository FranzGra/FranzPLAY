import { screen, waitFor, within } from "@testing-library/react";
import { renderApp, signedIn } from "../test/render";
import { tabFor } from "./Layout";
describe("navigation", () => {
    it("shows the home page with an empty state", async () => {
        renderApp("/");
        expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
    });
    it("has four tabs on the phone bar: Home, Categorie, Playlist, Profilo", async () => {
        renderApp("/");
        const tabbar = await screen.findByRole("navigation", { name: "Menu del telefono" });
        const labels = within(tabbar)
            .getAllByRole("link")
            .map((link) => link.textContent);
        expect(labels).toEqual(["Home", "Categorie", "Playlist", "Profilo"]);
    });
    it("marks the current page in the menus", async () => {
        const { user } = renderApp("/");
        const tabbar = await screen.findByRole("navigation", { name: "Menu del telefono" });
        await user.click(within(tabbar).getByRole("link", { name: "Profilo" }));
        expect(within(tabbar).getByRole("link", { name: "Profilo" })).toHaveAttribute("aria-current", "page");
        expect(within(tabbar).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    });
    it.each([
        ["/", 0],
        ["/cerca", 0],
        ["/categorie", 1],
        ["/categorie/Vacanze", 1],
        ["/playlist", 2],
        ["/playlist/4", 2],
        ["/mi-piace", 2],
        ["/condivisi", 2],
        ["/profilo", 3],
        ["/cronologia", 3],
        ["/carica", 3],
        ["/admin/persone", 3],
        ["/video/7", null],
        ["/canale/3", null],
        ["/playlists-old", null],
    ])("lights the phone tab of %s", (path, want) => {
        expect(tabFor(path)).toBe(want);
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
        const list = (id, kind, name) => ({
            id,
            kind,
            name,
            owner: { id: 1, name: "Paolo" },
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
        expect(await within(menu).findByRole("link", { name: "Gite" })).toHaveAttribute("href", "/playlist/2");
        expect(within(menu).getByRole("link", { name: "Guarda più tardi" })).toHaveAttribute("href", "/playlist/1");
    });
    it("puts «Guarda più tardi» first, then all playlists, then mine", async () => {
        const list = (id, kind, name) => ({
            id,
            kind,
            name,
            owner: { id: 1, name: "Paolo" },
            public: false,
            videos: 0,
            cover: null,
            updatedAt: "2026-10-12T09:00:00Z",
        });
        renderApp("/", {
            ...signedIn(),
            // The order from the server does not matter.
            "GET /api/playlists": {
                body: [list(2, "playlist", "Gite"), list(1, "later", ""), list(3, "playlist", "Ricette")],
            },
        });
        const menu = await screen.findByRole("navigation", { name: "Menu principale" });
        await within(menu).findByRole("link", { name: "Gite" });
        const names = within(menu)
            .getAllByRole("link")
            .map((link) => link.textContent);
        const start = names.indexOf("Guarda più tardi");
        expect(names.slice(start, start + 4)).toEqual([
            "Guarda più tardi",
            "Tutte le playlist",
            "Gite",
            "Ricette",
        ]);
    });
    describe("moving to another page", () => {
        // jsdom cannot animate: a stand-in records what the page asked for.
        const animate = vi.fn(() => ({ cancel: vi.fn() }));
        beforeEach(() => {
            animate.mockClear();
            Element.prototype.animate = animate;
        });
        afterEach(() => {
            delete Element.prototype.animate;
        });
        async function goToProfile() {
            const { user } = renderApp("/");
            const tabbar = await screen.findByRole("navigation", { name: "Menu del telefono" });
            // The first page's own move may come a moment after the frame shows:
            // wait for it, so only the move to the new page is counted.
            if (!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
                await waitFor(() => expect(animate).toHaveBeenCalled());
            }
            animate.mockClear();
            await user.click(within(tabbar).getByRole("link", { name: "Profilo" }));
        }
        it("lets the new page rise softly into place", async () => {
            await goToProfile();
            expect(animate).toHaveBeenCalledTimes(1);
            expect(animate).toHaveBeenCalledWith([
                { opacity: 0, translate: "0 10px" },
                { opacity: 1, translate: "0 0" },
            ], expect.objectContaining({ duration: 320 }));
        });
        it("moves nothing for whoever asked for less motion", async () => {
            vi.stubGlobal("matchMedia", (query) => ({
                matches: query === "(prefers-reduced-motion: reduce)",
            }));
            await goToProfile();
            expect(animate).not.toHaveBeenCalled();
        });
    });
    it("shows my initial in the top bar, as on my profile", async () => {
        renderApp("/");
        expect(await screen.findByRole("link", { name: "Il tuo profilo" })).toHaveTextContent("P");
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
