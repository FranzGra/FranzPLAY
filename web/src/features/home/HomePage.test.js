import { act, screen, within } from "@testing-library/react";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { videoJSON, watchedJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
import { pageSize } from "../videos/useVideoList";
function videos(from, count) {
    return Array.from({ length: count }, (_, i) => videoJSON({ id: from + i, title: `Video ${from + i}`, cover: null }));
}
describe("home page", () => {
    it("shows the newest videos as cards", async () => {
        renderApp("/", {
            ...signedIn(),
            "GET /api/videos": {
                body: {
                    videos: [
                        videoJSON(),
                        videoJSON({ id: 8, title: "Compleanno", category: "", duration: null, cover: null }),
                    ],
                    total: 2,
                },
            },
        });
        const list = await screen.findByRole("list", { name: "Tutti i video" });
        const cards = within(list).getAllByRole("link");
        expect(cards).toHaveLength(2);
        const first = cards[0];
        expect(first).toHaveAttribute("href", "/video/7");
        expect(within(first).getByRole("heading", { name: "Mare 2024" })).toBeInTheDocument();
        expect(within(first).getByText("4:05")).toBeInTheDocument();
        expect(first.querySelector("img")).toHaveAttribute("src", "/api/covers/7-0a1b2c3d.jpg");
        expect(within(first).getByText(/^Vacanze · /)).toBeInTheDocument();
        // A video not read yet: no duration, no cover, no category.
        const second = cards[1];
        expect(second.querySelector("img")).toBeNull();
        expect(within(second).queryByText(/:/)).not.toBeInTheDocument();
        expect(within(second).getByText(/fa$|oggi|ieri/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Mostra altri video" })).not.toBeInTheDocument();
    });
    it("shows new videos by itself when the library changes", async () => {
        stubEventSource();
        let list = videos(1, 1);
        renderApp("/", {
            ...signedIn(),
            "GET /api/videos": () => new Response(JSON.stringify({ videos: list, total: list.length })),
        });
        const grid = await screen.findByRole("list", { name: "Tutti i video" });
        expect(await within(grid).findByRole("heading", { name: "Video 1" })).toBeInTheDocument();
        list = [videoJSON({ id: 2, title: "Appena arrivato", cover: null }), ...list];
        act(() => FakeEventSource.last?.emit("library"));
        expect(await within(grid).findByRole("heading", { name: "Appena arrivato" })).toBeInTheDocument();
        expect(within(grid).getByRole("heading", { name: "Video 1" })).toBeInTheDocument();
    });
    it("filters by category with the chips", async () => {
        const { user, server } = renderApp("/", {
            ...signedIn(),
            "GET /api/categories": {
                body: [
                    { name: "Vacanze", videos: 1, color: "", image: null },
                    { name: "Scuola", videos: 1, color: "", image: null },
                ],
            },
            "GET /api/videos": (request) => {
                const category = new URL(request.url).searchParams.get("category");
                const body = category
                    ? { videos: [videoJSON({ id: 9, title: `Solo ${category}` })], total: 1 }
                    : { videos: videos(1, 2), total: 2 };
                return new Response(JSON.stringify(body));
            },
        });
        const chips = await screen.findByRole("list", { name: "Categorie" });
        expect(within(chips).getByRole("button", { name: "Tutti" })).toHaveAttribute("aria-pressed", "true");
        await user.click(within(chips).getByRole("button", { name: "Scuola" }));
        expect(await screen.findByRole("heading", { name: "Solo Scuola" })).toBeInTheDocument();
        expect(within(chips).getByRole("button", { name: "Scuola" })).toHaveAttribute("aria-pressed", "true");
        expect(server.requests.at(-1)?.url).toContain("category=Scuola");
        // However many categories there are, the last chip opens all of them.
        expect(within(chips).getByRole("link", { name: /Tutte le categorie/ })).toHaveAttribute("href", "/categorie");
        await user.click(within(chips).getByRole("button", { name: "Tutti" }));
        const grid = await screen.findByRole("list", { name: "Tutti i video" });
        expect(await within(grid).findByRole("heading", { name: "Video 1" })).toBeInTheDocument();
    });
    it("mixes all the videos, and shows the newest in their own row", async () => {
        const { server } = renderApp("/", {
            ...signedIn(),
            "GET /api/videos": (request) => {
                const mixed = new URL(request.url).searchParams.get("order") === "random";
                const body = mixed
                    ? { videos: [videoJSON({ id: 5, title: "A caso" })], total: 1 }
                    : { videos: [videoJSON({ id: 6, title: "Nuovissimo" })], total: 1 };
                return new Response(JSON.stringify(body));
            },
        });
        const grid = await screen.findByRole("list", { name: "Tutti i video" });
        expect(await within(grid).findByRole("heading", { name: "A caso" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 2, name: "Tutti i video" })).toBeInTheDocument();
        const latest = await screen.findByRole("region", { name: "Ultimi arrivati" });
        expect(within(latest).getByRole("heading", { name: "Nuovissimo" })).toBeInTheDocument();
        // The same order for the pages of one visit.
        const seeds = server.requests
            .map((r) => new URL(r.url).searchParams)
            .filter((p) => p.get("order") === "random")
            .map((p) => Number(p.get("seed")));
        expect(seeds.length).toBeGreaterThan(0);
        expect(seeds.every((seed) => seed === seeds[0] && seed >= 1 && seed <= 2 ** 31)).toBe(true);
    });
    it("loads more videos on request", async () => {
        const { user } = renderApp("/", {
            ...signedIn(),
            "GET /api/videos": (request) => {
                const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
                const count = Math.min(pageSize, pageSize + 5 - offset);
                return new Response(JSON.stringify({ videos: videos(offset + 1, count), total: pageSize + 5 }));
            },
        });
        const list = await screen.findByRole("list", { name: "Tutti i video" });
        expect(within(list).getAllByRole("listitem")).toHaveLength(pageSize);
        await user.click(screen.getByRole("button", { name: "Mostra altri video" }));
        expect(await screen.findByRole("heading", { name: `Video ${pageSize + 5}` })).toBeInTheDocument();
        expect(within(list).getAllByRole("listitem")).toHaveLength(pageSize + 5);
        expect(screen.queryByRole("button", { name: "Mostra altri video" })).not.toBeInTheDocument();
    });
    it("says so when more videos do not load", async () => {
        vi.spyOn(console, "error").mockImplementation(() => { });
        const { user } = renderApp("/", {
            ...signedIn(),
            "GET /api/videos": (request) => new URL(request.url).searchParams.has("offset")
                ? new Response("{}", { status: 500 })
                : new Response(JSON.stringify({ videos: videos(1, pageSize), total: 100 })),
        });
        await user.click(await screen.findByRole("button", { name: "Mostra altri video" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Non sono riuscito a caricare altri video");
        expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(pageSize); // the first page stays
    });
    it("explains an empty library", async () => {
        renderApp("/");
        expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
        expect(screen.queryByRole("list", { name: "Categorie" })).not.toBeInTheDocument();
    });
    it("explains a server that does not answer", async () => {
        vi.spyOn(console, "error").mockImplementation(() => { });
        renderApp("/", {
            ...signedIn(),
            "GET /api/videos": { status: 500, body: { error: "internal error" } },
        });
        expect(await screen.findByRole("heading", { name: "Video non disponibili" })).toBeInTheDocument();
    });
    it("shows the videos to continue, with how much was watched", async () => {
        const { user } = renderApp("/", {
            ...signedIn(),
            "GET /api/categories": { body: [{ name: "Vacanze", videos: 1, color: "", image: null }] },
            "GET /api/continue": {
                body: [
                    watchedJSON({
                        video: videoJSON({ id: 3, title: "A metà", duration: 200 }),
                        position: 50,
                    }),
                ],
            },
            "GET /api/videos": { body: { videos: [videoJSON()], total: 1 } },
        });
        const row = await screen.findByRole("region", { name: "Continua a guardare" });
        const card = within(row).getByRole("link");
        expect(card).toHaveAttribute("href", "/video/3");
        expect(within(card).getByText("Visto al 25%")).toBeInTheDocument();
        // Only on "Tutti": a category shows just its videos.
        await user.click(screen.getByRole("button", { name: "Vacanze" }));
        expect(screen.queryByRole("region", { name: "Continua a guardare" })).not.toBeInTheDocument();
    });
    it("shows no continue row when nothing was started", async () => {
        renderApp("/", {
            ...signedIn(),
            "GET /api/videos": { body: { videos: [videoJSON()], total: 1 } },
        });
        await screen.findByRole("list", { name: "Tutti i video" });
        expect(screen.queryByRole("heading", { name: "Continua a guardare" })).not.toBeInTheDocument();
    });
    it("shows the videos the person may like, each saying why", async () => {
        renderApp("/", {
            ...signedIn(),
            "GET /api/recommended": {
                body: [{ video: videoJSON({ id: 4, title: "Montagna" }), reason: "yourCategory" }],
            },
            "GET /api/videos": { body: { videos: [videoJSON()], total: 1 } },
        });
        const row = await screen.findByRole("region", { name: "Potrebbe piacerti" });
        const card = within(row).getByRole("link");
        expect(card).toHaveAttribute("href", "/video/4");
        expect(within(card).getByText("Perché guardi Vacanze")).toBeInTheDocument();
    });
    it("shows no suggestions while there is nothing to go by", async () => {
        renderApp("/", {
            ...signedIn(),
            "GET /api/recommended": { body: [] },
            "GET /api/videos": { body: { videos: [videoJSON()], total: 1 } },
        });
        await screen.findByRole("list", { name: "Tutti i video" });
        expect(screen.queryByRole("heading", { name: "Potrebbe piacerti" })).not.toBeInTheDocument();
    });
});
