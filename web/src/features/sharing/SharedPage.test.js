import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
describe("shared with me page", () => {
    it("lists the videos shared with me", async () => {
        const { server } = renderApp("/condivisi", {
            ...signedIn(),
            "GET /api/playlists/shared": { body: [] },
            "GET /api/videos": {
                body: {
                    videos: [
                        videoJSON({ title: "Compleanno", private: true, uploader: { id: 5, name: "Giulia" } }),
                    ],
                    total: 1,
                },
            },
        });
        expect(await screen.findByRole("heading", { name: "Condivisi con te" })).toBeInTheDocument();
        expect(await screen.findByText("Compleanno")).toBeInTheDocument();
        const asked = new URL(server.requests.find((r) => r.url.includes("/api/videos"))?.url ?? "");
        expect(asked.searchParams.get("shared")).toBe("1");
    });
    it("says what will appear when nothing is shared yet", async () => {
        renderApp("/condivisi", {
            ...signedIn(),
            "GET /api/playlists/shared": { body: [] },
            "GET /api/videos": { body: { videos: [], total: 0 } },
        });
        expect(await screen.findByText("Nessuno ti ha condiviso niente, per ora")).toBeInTheDocument();
    });
    it("lists the playlists shared with me, with whose they are", async () => {
        renderApp("/condivisi", {
            ...signedIn(),
            "GET /api/playlists/shared": {
                body: [
                    {
                        id: 9,
                        kind: "playlist",
                        name: "Natale",
                        owner: { id: 5, name: "Giulia" },
                        public: false,
                        sharedWith: [],
                        videos: 3,
                        cover: null,
                        updatedAt: "2026-10-12T09:00:00Z",
                    },
                ],
            },
            "GET /api/videos": { body: { videos: [], total: 0 } },
        });
        const lists = await screen.findByRole("region", { name: "Playlist condivise con te" });
        expect(within(lists).getByRole("link", { name: /Natale/ })).toHaveAttribute("href", "/playlist/9");
        expect(within(lists).getByText("Playlist · 3 video · di Giulia")).toBeInTheDocument();
        expect(await screen.findByText("Nessun video condiviso con te")).toBeInTheDocument();
    });
});
