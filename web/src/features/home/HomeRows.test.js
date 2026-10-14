import { screen, within } from "@testing-library/react";
import { videoJSON, watchedJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
const look = { columns: 0, size: 3, sections: "one" };
const routes = {
    ...signedIn(),
    "GET /api/continue": { body: [watchedJSON({ video: videoJSON({ id: 3, title: "A metà" }) })] },
    "GET /api/likes": { body: { videos: [videoJSON({ id: 4, title: "Torta" })], total: 1 } },
};
describe("home rows", () => {
    it("closes a row by its title and remembers it on the server", async () => {
        const { user, server } = renderApp("/", {
            ...routes,
            "PUT /api/home/rows/liked": { body: { closed: ["liked"], look } },
        });
        const row = await screen.findByRole("region", { name: "Ti piacciono" });
        const toggle = within(row).getByRole("button", { name: "Ti piacciono" });
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        await user.click(toggle);
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(within(row).queryByRole("heading", { name: "Torta" })).not.toBeInTheDocument();
        expect(within(row).queryByRole("link", { name: /Vedi tutti/ })).not.toBeInTheDocument();
        const put = server.requests.find((r) => r.method === "PUT");
        expect(put?.url).toMatch(/\/api\/home\/rows\/liked$/);
        expect(await put?.clone().json()).toEqual({ open: false });
        // The other rows stay as they were.
        const other = screen.getByRole("region", { name: "Continua a guardare" });
        expect(within(other).getByRole("heading", { name: "A metà" })).toBeInTheDocument();
    });
    it("shows closed the rows the person closed before", async () => {
        const { user, server } = renderApp("/", {
            ...routes,
            "GET /api/home": { body: { closed: ["continue"], look } },
            "PUT /api/home/rows/continue": { body: { closed: [], look } },
        });
        const row = await screen.findByRole("region", { name: "Continua a guardare" });
        expect(within(row).getByRole("button", { name: "Continua a guardare" })).toHaveAttribute("aria-expanded", "false");
        expect(within(row).queryByRole("list")).not.toBeInTheDocument();
        await user.click(within(row).getByRole("button", { name: "Continua a guardare" }));
        expect(within(row).getByRole("heading", { name: "A metà" })).toBeInTheDocument();
        const put = server.requests.find((r) => r.method === "PUT");
        expect(await put?.clone().json()).toEqual({ open: true });
    });
    it("opens every row when the layout does not load", async () => {
        vi.spyOn(console, "error").mockImplementation(() => { });
        renderApp("/", { ...routes, "GET /api/home": { status: 500, body: { error: "boom" } } });
        const row = await screen.findByRole("region", { name: "Ti piacciono" });
        expect(within(row).getByRole("heading", { name: "Torta" })).toBeInTheDocument();
    });
});
