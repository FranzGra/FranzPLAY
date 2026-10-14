import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, signedIn, testAccount } from "../../test/render";
import { loadPhoto, renderCrop } from "./photo";
// jsdom has no real images or canvas: the two browser-only steps are faked.
vi.mock("./photo", () => ({
    loadPhoto: vi.fn(async () => ({ url: "blob:photo", width: 1600, height: 1000 })),
    renderCrop: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));
function pickFile() {
    const file = new File(["x"], "mare.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Scegli una foto"), { target: { files: [file] } });
}
describe("profile photo", () => {
    it("shows the initial until there is a photo", async () => {
        renderApp("/profilo");
        expect(await screen.findByRole("button", { name: "Aggiungi una foto" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Togli la foto" })).not.toBeInTheDocument();
        expect(document.querySelector('img[src^="/api/users/"]')).toBeNull();
    });
    it("crops and saves a new photo", async () => {
        const { user, server } = renderApp("/profilo", {
            ...signedIn(),
            "PUT /api/me/avatar": { body: { ...testAccount, avatar: 1760263200000 } },
        });
        await screen.findByRole("button", { name: "Aggiungi una foto" });
        pickFile();
        const dialog = await screen.findByRole("dialog", { name: "Sistema la foto" });
        // Zoom in, then move the photo with the keyboard.
        fireEvent.change(within(dialog).getByLabelText("Zoom"), { target: { value: "2" } });
        const window = within(dialog).getByRole("img", { name: /Foto da ritagliare/ });
        fireEvent.keyDown(window, { key: "ArrowLeft" });
        await user.click(within(dialog).getByRole("button", { name: "Salva la foto" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        // The window is 260 wide; at zoom 2 the 1000-pixel side fills 520, so
        // the window shows 500 photo pixels, moved left by 10 / 0.52 of them.
        expect(vi.mocked(renderCrop)).toHaveBeenCalledWith("blob:photo", {
            x: expect.closeTo(550 - 10 / 0.52),
            y: 250,
            side: 500,
        });
        const sent = server.requests.at(-1);
        expect(sent?.headers.get("Content-Type")).toBe("image/jpeg");
        // The new photo shows at once, in the top bar too.
        const photos = document.querySelectorAll('img[src="/api/users/1/avatar?v=1760263200000"]');
        expect(photos).toHaveLength(2);
        expect(screen.getByRole("button", { name: "Togli la foto" })).toBeInTheDocument();
    });
    it("closes without saving", async () => {
        const { user, server } = renderApp("/profilo");
        await screen.findByRole("button", { name: "Aggiungi una foto" });
        pickFile();
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Annulla" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(server.requests.some((r) => r.url.includes("/api/me/avatar"))).toBe(false);
    });
    it("says when the server refuses the photo", async () => {
        vi.spyOn(console, "error").mockImplementation(() => { });
        const { user } = renderApp("/profilo", {
            ...signedIn(),
            "PUT /api/me/avatar": { status: 400, body: { error: "bad photo" } },
        });
        await screen.findByRole("button", { name: "Aggiungi una foto" });
        pickFile();
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "Salva la foto" }));
        expect(await within(dialog).findByRole("alert")).toHaveTextContent("non va bene");
    });
    it("says when the picture cannot be opened", async () => {
        vi.spyOn(console, "error").mockImplementation(() => { });
        vi.mocked(loadPhoto).mockRejectedValueOnce(new Error("not a picture"));
        renderApp("/profilo");
        await screen.findByRole("button", { name: "Aggiungi una foto" });
        pickFile();
        expect(await screen.findByRole("alert")).toHaveTextContent("non si apre");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    it("takes the photo away", async () => {
        const { user } = renderApp("/profilo", {
            ...signedIn({ ...testAccount, avatar: 5 }),
            "DELETE /api/me/avatar": { body: { ...testAccount, avatar: 0 } },
        });
        expect(await screen.findByRole("button", { name: "Cambia foto" })).toBeInTheDocument();
        expect(document.querySelectorAll('img[src="/api/users/1/avatar?v=5"]')).toHaveLength(2);
        await user.click(screen.getByRole("button", { name: "Togli la foto" }));
        expect(await screen.findByRole("button", { name: "Aggiungi una foto" })).toBeInTheDocument();
        expect(document.querySelector('img[src^="/api/users/"]')).toBeNull();
    });
});
