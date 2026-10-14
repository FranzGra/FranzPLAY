import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";
function recent(overrides = {}) {
    return {
        id: 5,
        author: { id: 2, name: "Giulia", avatar: 0 },
        body: "Che bello!",
        createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        video: { id: 7, title: "Mare 2024", visible: true },
        reply: false,
        replies: 2,
        ...overrides,
    };
}
describe("comments page", () => {
    it("lists every comment with its video", async () => {
        renderApp("/admin/commenti", {
            ...signedIn(),
            "GET /api/comments": {
                body: {
                    comments: [
                        recent(),
                        recent({
                            id: 6,
                            author: { id: 3, name: "Marco", avatar: 0 },
                            body: "Vero",
                            reply: true,
                            replies: 0,
                            video: { id: 8, title: "Segreto", visible: false },
                        }),
                    ],
                    total: 2,
                },
            },
        });
        const list = await screen.findByRole("list", { name: "Commenti" });
        const [first, second] = within(list).getAllByRole("listitem");
        expect(first).toHaveTextContent("Giulia ha scritto sotto Mare 2024 · 5 minuti fa");
        expect(within(first).getByRole("link", { name: "Mare 2024" })).toHaveAttribute("href", "/video/7");
        expect(second).toHaveTextContent("Marco ha risposto sotto Segreto (nascosto o non trovato)");
        expect(within(second).queryByRole("link")).not.toBeInTheDocument();
        expect(screen.getByText("2 commenti")).toBeInTheDocument();
    });
    it("deletes a comment with its replies after asking", async () => {
        let comments = [recent(), recent({ id: 9, body: "Una risposta", reply: true, replies: 0 })];
        const { user, server } = renderApp("/admin/commenti", {
            ...signedIn(),
            "GET /api/comments": () => new Response(JSON.stringify({ comments, total: comments.length })),
            "DELETE /api/comments/5": () => {
                comments = [];
                return new Response(null, { status: 204 });
            },
        });
        const list = await screen.findByRole("list", { name: "Commenti" });
        const [first] = within(list).getAllByRole("listitem");
        await user.click(within(first).getByRole("button", { name: /Elimina/ }));
        expect(within(list).getByText(/Spariscono anche le sue 2 risposte/)).toBeInTheDocument();
        await user.click(within(list).getByRole("button", { name: "Sì, elimina" }));
        // The reply goes too: the list is asked again.
        expect(await screen.findByRole("heading", { name: "Ancora nessun commento" })).toBeInTheDocument();
        expect(server.requests.some((r) => r.method === "DELETE")).toBe(true);
    });
    it("explains an empty list", async () => {
        renderApp("/admin/commenti", {
            ...signedIn(),
            "GET /api/comments": { body: { comments: [], total: 0 } },
        });
        expect(await screen.findByRole("heading", { name: "Ancora nessun commento" })).toBeInTheDocument();
    });
});
