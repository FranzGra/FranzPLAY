import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeServer, type Routes } from "../../test/render";
import { SaveButton } from "./SaveButton";

const later = {
  id: 1,
  kind: "later",
  name: "",
  owner: { id: 1, name: "Paolo" },
  public: false,
  videos: 0,
  cover: null,
  updatedAt: "2026-10-12T09:00:00Z",
  contains: false,
};
const trips = { ...later, id: 2, kind: "playlist", name: "Gite", contains: true };

function setup(routes: Routes) {
  const server = fakeServer(routes);
  const user = userEvent.setup();
  render(<SaveButton videoId={7} />);
  return { user, server };
}

describe("save button", () => {
  it("puts the video in a list and takes it out", async () => {
    const { user, server } = setup({
      "GET /api/playlists": { body: [later, trips] },
      "PUT /api/playlists/1/videos/7": { status: 204 },
      "DELETE /api/playlists/2/videos/7": { status: 204 },
    });
    await user.click(screen.getByRole("button", { name: "Salva" }));
    expect(screen.getByRole("dialog", { name: "Salva in una playlist" })).toBeInTheDocument();
    const watchLater = await screen.findByRole("checkbox", { name: "Guarda più tardi" });
    const gite = screen.getByRole("checkbox", { name: "Gite" });
    expect(watchLater).not.toBeChecked();
    expect(gite).toBeChecked();

    await user.click(watchLater);
    await user.click(gite);
    expect(watchLater).toBeChecked();
    expect(gite).not.toBeChecked();
    expect(new URL(server.requests[0]?.url ?? "").search).toBe("?video=7");
    expect(server.requests.slice(1).map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "PUT /api/playlists/1/videos/7",
      "DELETE /api/playlists/2/videos/7",
    ]);
  });

  it("makes the button's icon jump when the video goes into a list", async () => {
    setup({
      "GET /api/playlists": { body: [later, trips] },
      "PUT /api/playlists/1/videos/7": { status: 204 },
      "DELETE /api/playlists/2/videos/7": { status: 204 },
    });
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Salva" });
    const icon = () => button.querySelector("span");
    await user.click(button);
    expect(icon()).not.toHaveAttribute("data-bounce");
    // Taking it out of a list is no reason to jump.
    await user.click(await screen.findByRole("checkbox", { name: "Gite" }));
    expect(icon()).not.toHaveAttribute("data-bounce");
    await user.click(screen.getByRole("checkbox", { name: "Guarda più tardi" }));
    expect(icon()).toHaveAttribute("data-bounce");
    // Only the list just ticked draws its tick.
    expect(
      screen.getByRole("checkbox", { name: "Guarda più tardi" }).closest("li"),
    ).toHaveAttribute("data-touched");
    expect(screen.getByRole("checkbox", { name: "Gite" }).closest("li")).not.toHaveAttribute(
      "data-touched",
    );
  });

  it("goes back when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = setup({
      "GET /api/playlists": { body: [later] },
      "PUT /api/playlists/1/videos/7": { status: 500, body: { error: "internal error" } },
    });
    await user.click(screen.getByRole("button", { name: "Salva" }));
    const watchLater = await screen.findByRole("checkbox", { name: "Guarda più tardi" });
    await user.click(watchLater);
    expect(await screen.findByRole("alert")).toHaveTextContent("Non sono riuscito a salvare");
    expect(watchLater).not.toBeChecked();
  });

  it("makes a new list with the video in it", async () => {
    const { user, server } = setup({
      "GET /api/playlists": { body: [later] },
      "POST /api/playlists": {
        status: 201,
        body: { ...trips, id: 5, name: "Feste", contains: undefined },
      },
      "PUT /api/playlists/5/videos/7": { status: 204 },
    });
    await user.click(screen.getByRole("button", { name: "Salva" }));
    await user.click(await screen.findByRole("button", { name: "Nuova playlist" }));
    await user.type(screen.getByRole("textbox", { name: "Nome della nuova playlist" }), "Feste");
    await user.click(screen.getByRole("button", { name: "Crea" }));
    expect(await screen.findByRole("checkbox", { name: "Feste" })).toBeChecked();
    expect(server.requests.map((r) => r.method)).toEqual(["GET", "POST", "PUT"]);
  });

  it("closes with Escape", async () => {
    const { user } = setup({ "GET /api/playlists": { body: [later] } });
    const button = screen.getByRole("button", { name: "Salva" });
    await user.click(button);
    await screen.findByRole("checkbox", { name: "Guarda più tardi" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  describe("on a phone", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: query !== "(min-width: 600px)" }));
    });

    it("covers the whole screen, outside the button, and keeps the page still", async () => {
      const { user } = setup({ "GET /api/playlists": { body: [later, trips] } });
      const button = screen.getByRole("button", { name: "Salva" });
      await user.click(button);
      const sheet = screen.getByRole("dialog", { name: "Salva in una playlist" });
      expect(sheet).toHaveAttribute("aria-modal", "true");
      // It lives in the page's body, so no box around the button cuts it.
      expect(sheet.parentElement).toBe(document.body);
      expect(document.body.style.overflow).toBe("hidden");
      expect(screen.getByRole("heading", { name: "Salva in una playlist" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Chiudi" })).toHaveFocus();

      // A touch inside the sheet does not close it.
      await user.click(await screen.findByRole("checkbox", { name: "Gite" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Fatto" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe("");
      expect(button).toHaveFocus();
    });

    it("closes with the cross", async () => {
      const { user } = setup({ "GET /api/playlists": { body: [later] } });
      await user.click(screen.getByRole("button", { name: "Salva" }));
      await user.click(screen.getByRole("button", { name: "Chiudi" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("stays a small panel by the button on a computer, above everything", async () => {
    const { user } = setup({ "GET /api/playlists": { body: [later] } });
    const button = screen.getByRole("button", { name: "Salva" });
    button.getBoundingClientRect = () => new DOMRect(100, 50, 90, 40);
    await user.click(button);
    const panel = screen.getByRole("dialog", { name: "Salva in una playlist" });
    expect(panel).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("button", { name: "Fatto" })).not.toBeInTheDocument();
    // It lives in the page's body, so the videos on the right cannot cover
    // it, and it hangs just under the button.
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.left).toBe("100px");
    expect(panel.style.top).toBe("98px");
    expect(screen.getByRole("button", { name: "Chiudi" })).toHaveFocus();
  });

  it("opens above the button when there is no room under it", async () => {
    const { user } = setup({ "GET /api/playlists": { body: [later] } });
    const button = screen.getByRole("button", { name: "Salva" });
    const top = window.innerHeight - 200;
    button.getBoundingClientRect = () => new DOMRect(100, top, 90, 40);
    await user.click(button);
    const panel = screen.getByRole("dialog", { name: "Salva in una playlist" });
    expect(panel).toHaveAttribute("data-above");
    expect(panel.style.bottom).toBe("208px");
    expect(panel.style.top).toBe("");
  });
});
