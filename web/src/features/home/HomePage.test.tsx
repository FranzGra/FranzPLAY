import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
import { pageSize } from "../videos/useVideoList";

function videos(from: number, count: number) {
  return Array.from({ length: count }, (_, i) =>
    videoJSON({ id: from + i, title: `Video ${from + i}`, cover: null }),
  );
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
    const list = await screen.findByRole("list", { name: "Ultimi video" });
    const cards = within(list).getAllByRole("link");
    expect(cards).toHaveLength(2);

    const first = cards[0] as HTMLElement;
    expect(first).toHaveAttribute("href", "/video/7");
    expect(within(first).getByRole("heading", { name: "Mare 2024" })).toBeInTheDocument();
    expect(within(first).getByText("4:05")).toBeInTheDocument();
    expect(first.querySelector("img")).toHaveAttribute("src", "/api/covers/7-0a1b2c3d.jpg");
    expect(within(first).getByText(/^Vacanze · /)).toBeInTheDocument();

    // A video not read yet: no duration, no cover, no category.
    const second = cards[1] as HTMLElement;
    expect(second.querySelector("img")).toBeNull();
    expect(within(second).queryByText(/:/)).not.toBeInTheDocument();
    expect(within(second).getByText(/fa$|oggi|ieri/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mostra altri video" })).not.toBeInTheDocument();
  });

  it("filters by category with the chips", async () => {
    const { user, server } = renderApp("/", {
      ...signedIn(),
      "GET /api/categories": {
        body: [
          { name: "Vacanze", videos: 1 },
          { name: "Scuola", videos: 1 },
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
    expect(within(chips).getByRole("button", { name: "Tutti" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(chips).getByRole("button", { name: "Scuola" }));
    expect(await screen.findByRole("heading", { name: "Solo Scuola" })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: "Scuola" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(server.requests.at(-1)?.url).toContain("category=Scuola");

    await user.click(within(chips).getByRole("button", { name: "Tutti" }));
    expect(await screen.findByRole("heading", { name: "Video 1" })).toBeInTheDocument();
  });

  it("loads more videos on request", async () => {
    const { user } = renderApp("/", {
      ...signedIn(),
      "GET /api/videos": (request) => {
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
        const count = Math.min(pageSize, pageSize + 5 - offset);
        return new Response(
          JSON.stringify({ videos: videos(offset + 1, count), total: pageSize + 5 }),
        );
      },
    });
    const list = await screen.findByRole("list", { name: "Ultimi video" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(pageSize);

    await user.click(screen.getByRole("button", { name: "Mostra altri video" }));
    expect(
      await screen.findByRole("heading", { name: `Video ${pageSize + 5}` }),
    ).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(pageSize + 5);
    expect(screen.queryByRole("button", { name: "Mostra altri video" })).not.toBeInTheDocument();
  });

  it("says so when more videos do not load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/", {
      ...signedIn(),
      "GET /api/videos": (request) =>
        new URL(request.url).searchParams.has("offset")
          ? new Response("{}", { status: 500 })
          : new Response(JSON.stringify({ videos: videos(1, pageSize), total: 100 })),
    });
    await user.click(await screen.findByRole("button", { name: "Mostra altri video" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Non sono riuscito a caricare altri video",
    );
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(pageSize); // the first page stays
  });

  it("explains an empty library", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Ancora nessun video" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Categorie" })).not.toBeInTheDocument();
  });

  it("explains a server that does not answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderApp("/", {
      ...signedIn(),
      "GET /api/videos": { status: 500, body: { error: "internal error" } },
    });
    expect(
      await screen.findByRole("heading", { name: "Video non disponibili" }),
    ).toBeInTheDocument();
  });
});
