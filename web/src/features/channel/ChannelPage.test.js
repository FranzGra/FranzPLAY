import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn, testAccount } from "../../test/render";
const list = {
    id: 2,
    kind: "playlist",
    name: "Gite",
    owner: { id: 5, name: "Giulia" },
    public: true,
    videos: 3,
    cover: null,
    updatedAt: "2026-10-12T09:00:00Z",
};
const channel = (over = {}) => ({
    id: 5,
    name: "Giulia",
    avatar: 0,
    since: "2026-03-10T09:00:00Z",
    playlists: [list],
    ...over,
});
describe("channel page", () => {
    it("shows a person and their public playlists", async () => {
        renderApp("/canale/5", { ...signedIn(), "GET /api/channels/5": { body: channel() } });
        expect(await screen.findByRole("heading", { level: 1, name: "Giulia" })).toBeInTheDocument();
        expect(screen.getByText("Su FranzPLAY da marzo 2026")).toBeInTheDocument();
        const card = screen.getByRole("link", { name: /Gite/ });
        expect(card).toHaveAttribute("href", "/playlist/2");
        expect(within(card).getByText("Playlist · 3 video")).toBeInTheDocument();
    });
    it("shows the videos the person uploaded", async () => {
        const { server } = renderApp("/canale/5", {
            ...signedIn(),
            "GET /api/channels/5": { body: channel() },
            "GET /api/videos": {
                body: {
                    videos: [videoJSON({ title: "Al mare", uploader: { id: 5, name: "Giulia" } })],
                    total: 1,
                },
            },
        });
        const videos = await screen.findByRole("list", { name: "Video caricati da Giulia" });
        expect(within(videos).getByText("Al mare")).toBeInTheDocument();
        const asked = server.requests.find((r) => r.url.includes("/api/videos"));
        expect(new URL(asked?.url ?? "").searchParams.get("uploader")).toBe("5");
    });
    it("shows no videos box for who never uploaded one", async () => {
        renderApp("/canale/5", {
            ...signedIn(),
            "GET /api/channels/5": { body: channel() },
            "GET /api/videos": { body: { videos: [], total: 0 } },
        });
        await screen.findByRole("heading", { level: 2, name: "Playlist" });
        expect(screen.queryByRole("heading", { name: "Video" })).not.toBeInTheDocument();
    });
    it("tells me where my uploaded videos will appear", async () => {
        renderApp("/canale/1", {
            ...signedIn({ ...testAccount, canUpload: true }),
            "GET /api/channels/1": { body: channel({ id: 1, name: "Paolo" }) },
            "GET /api/videos": { body: { videos: [], total: 0 } },
        });
        expect(await screen.findByText("Nessun video caricato")).toBeInTheDocument();
    });
    it("shows the person's photo when they have one", async () => {
        renderApp("/canale/5", {
            ...signedIn(),
            "GET /api/channels/5": { body: channel({ avatar: 77 }) },
        });
        await screen.findByRole("heading", { level: 1, name: "Giulia" });
        expect(document.querySelector('img[src="/api/users/5/avatar?v=77"]')).not.toBeNull();
    });
    it("explains an empty channel to someone else", async () => {
        renderApp("/canale/5", {
            ...signedIn(),
            "GET /api/channels/5": { body: channel({ playlists: [] }) },
        });
        expect(await screen.findByText("Nessuna playlist pubblica")).toBeInTheDocument();
    });
    it("tells me how to fill my own channel", async () => {
        renderApp("/canale/1", {
            ...signedIn(),
            "GET /api/channels/1": { body: channel({ id: 1, name: "Paolo", playlists: [] }) },
        });
        expect(await screen.findByText("Il tuo canale è ancora vuoto")).toBeInTheDocument();
        expect(screen.getByText(/questo è il tuo canale/)).toBeInTheDocument();
    });
    it("says when the person is not there", async () => {
        renderApp("/canale/99", {
            ...signedIn(),
            "GET /api/channels/99": { status: 404, body: { error: "channel not found" } },
        });
        expect(await screen.findByRole("heading", { name: "Canale non trovato" })).toBeInTheDocument();
    });
    it("is reached from the side menu", async () => {
        renderApp("/", signedIn());
        const menu = await screen.findByRole("navigation", { name: "Menu principale" });
        expect(within(menu).getByRole("link", { name: "Il mio canale" })).toHaveAttribute("href", "/canale/1");
    });
});
