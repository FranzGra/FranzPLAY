import { screen, within } from "@testing-library/react";
import { videoJSON, watchedJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
const today = new Date();
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
const twoVideos = {
    items: [
        watchedJSON({
            video: videoJSON({ id: 7, title: "Mare 2024" }),
            watchedAt: today.toISOString(),
        }),
        watchedJSON({
            video: videoJSON({ id: 8, title: "Montagna", duration: 100 }),
            finished: true,
            position: 0,
            watchedAt: yesterday.toISOString(),
        }),
    ],
    total: 2,
};
describe("history page", () => {
    it("lists the videos watched, grouped by day", async () => {
        renderApp("/cronologia", { ...signedIn(), "GET /api/history": { body: twoVideos } });
        const todayGroup = await screen.findByRole("region", { name: "Oggi" });
        expect(within(todayGroup).getByRole("link", { name: /Mare 2024/ })).toHaveAttribute("href", "/video/7");
        const yesterdayGroup = screen.getByRole("region", { name: "Ieri" });
        // A finished video shows its bar full.
        expect(within(yesterdayGroup).getByText("Visto al 100%")).toBeInTheDocument();
    });
    it("explains an empty history", async () => {
        renderApp("/cronologia", {
            ...signedIn(),
            "GET /api/history": { body: { items: [], total: 0 } },
        });
        expect(await screen.findByRole("heading", { name: "Nessun video visto" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Cancella cronologia" })).not.toBeInTheDocument();
    });
    it("removes one video", async () => {
        const { user, server } = renderApp("/cronologia", {
            ...signedIn(),
            "GET /api/history": { body: twoVideos },
            "DELETE /api/history/7": { status: 204 },
        });
        await user.click(await screen.findByRole("button", { name: "Togli «Mare 2024» dalla cronologia" }));
        expect(await screen.findByRole("region", { name: "Ieri" })).toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Oggi" })).not.toBeInTheDocument();
        expect(server.requests.some((r) => r.method === "DELETE")).toBe(true);
    });
    it("says so when a video cannot be removed", async () => {
        vi.spyOn(console, "error").mockImplementation(() => { });
        const { user } = renderApp("/cronologia", {
            ...signedIn(),
            "GET /api/history": { body: twoVideos },
            "DELETE /api/history/7": { status: 500, body: { error: "internal error" } },
        });
        await user.click(await screen.findByRole("button", { name: "Togli «Mare 2024» dalla cronologia" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("Non sono riuscito a togliere");
        expect(screen.getByRole("region", { name: "Oggi" })).toBeInTheDocument();
    });
    it("empties the history after asking once more", async () => {
        const { user, server } = renderApp("/cronologia", {
            ...signedIn(),
            "GET /api/history": { body: twoVideos },
            "DELETE /api/history": { status: 204 },
        });
        await user.click(await screen.findByRole("button", { name: "Cancella cronologia" }));
        await user.click(screen.getByRole("button", { name: "Annulla" }));
        expect(server.requests.some((r) => r.method === "DELETE")).toBe(false);
        await user.click(screen.getByRole("button", { name: "Cancella cronologia" }));
        await user.click(screen.getByRole("button", { name: "Sì, cancella" }));
        expect(await screen.findByRole("heading", { name: "Nessun video visto" })).toBeInTheDocument();
    });
    it("loads more videos on request", async () => {
        const { user, server } = renderApp("/cronologia", {
            ...signedIn(),
            "GET /api/history": (request) => {
                const offset = new URL(request.url).searchParams.get("offset");
                const body = offset === "0"
                    ? { items: [twoVideos.items[0]], total: 2 }
                    : { items: [twoVideos.items[1]], total: 2 };
                return new Response(JSON.stringify(body));
            },
        });
        await user.click(await screen.findByRole("button", { name: "Mostra altri video" }));
        expect(await screen.findByRole("region", { name: "Ieri" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Mostra altri video" })).not.toBeInTheDocument();
        expect(server.requests.at(-1)?.url).toContain("offset=1");
    });
    it("explains a server that does not answer", async () => {
        vi.spyOn(console, "error").mockImplementation(() => { });
        renderApp("/cronologia", {
            ...signedIn(),
            "GET /api/history": { status: 500, body: { error: "internal error" } },
        });
        expect(await screen.findByRole("heading", { name: "Cronologia non disponibile" })).toBeInTheDocument();
    });
});
