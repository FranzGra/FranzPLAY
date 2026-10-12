import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeServer, type Routes } from "../../test/render";
import { SaveButton } from "./SaveButton";

const later = {
  id: 1,
  kind: "later",
  name: "",
  owner: { id: 1, name: "Francesco" },
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
});
