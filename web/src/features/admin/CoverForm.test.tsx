import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
import { renderCover } from "./coverImage";

// jsdom has no real images or canvas: the two browser-only steps are faked.
vi.mock("../profile/photo", () => ({
  loadPhoto: vi.fn(async () => ({ url: "blob:picture", width: 1600, height: 1600 })),
}));
vi.mock("./coverImage", () => ({
  renderCover: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));

function adminVideo(overrides: Record<string, unknown> = {}) {
  return {
    ...videoJSON(),
    folder: "/media/video",
    path: "Vacanze/Mare 2024.mp4",
    hidden: false,
    missing: false,
    foundTitle: "Mare 2024",
    foundCategory: "Vacanze",
    titleSet: false,
    categorySet: false,
    coverChoice: "",
    coverSecond: null,
    clipChoice: "",
    videoCodec: "h264",
    audioCodec: "aac",
    hasCopy: false,
    ...overrides,
  };
}

async function openCover(routes: Record<string, unknown>) {
  const app = renderApp("/admin/video", {
    ...signedIn(),
    "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
    ...routes,
  });
  await screen.findByRole("list", { name: "Video" });
  await app.user.click(screen.getByRole("button", { name: "Copertina" }));
  return { ...app, panel: screen.getByRole("region", { name: "Copertina di Mare 2024" }) };
}

describe("choosing a cover", () => {
  it("uploads an image cut to the shape of a cover", async () => {
    const { user, server, panel } = await openCover({
      "PUT /api/admin/videos/7/cover": { status: 204 },
    });
    expect(panel).toHaveTextContent("La copertina ora la sceglie FranzPLAY");
    const file = new File(["x"], "foto.png", { type: "image/png" });
    fireEvent.change(within(panel).getByLabelText("Carica un'immagine"), {
      target: { files: [file] },
    });
    const dialog = await screen.findByRole("dialog", { name: "Sistema la copertina" });
    // The window is 272 × 153; a square picture 1600 wide fills its width,
    // so the window shows 1600 × 900 of it, from the middle. Moved up by
    // one step of 10 window pixels, the cut goes down by 10 / 0.17 pixels.
    fireEvent.keyDown(within(dialog).getByRole("img", { name: /Immagine da ritagliare/ }), {
      key: "ArrowDown",
    });
    await user.click(within(dialog).getByRole("button", { name: "Usa come copertina" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(vi.mocked(renderCover)).toHaveBeenCalledWith("blob:picture", {
      x: expect.closeTo(0),
      y: expect.closeTo(350 + 10 / 0.17),
      width: expect.closeTo(1600),
      height: expect.closeTo(900),
    });
    const sent = server.requests.at(-1);
    expect(sent?.url).toContain("/api/admin/videos/7/cover");
    expect(sent?.headers.get("Content-Type")).toBe("image/jpeg");
    expect(await screen.findByRole("status")).toHaveTextContent("la nuova copertina arriva");
    expect(screen.getByText("Copertina scelta")).toBeInTheDocument();
  });

  it("uses a moment of the video", async () => {
    const { user, server, panel } = await openCover({
      "PUT /api/admin/videos/7/cover-second": { status: 204 },
    });
    await user.click(within(panel).getByRole("button", { name: "Scegli un momento" }));
    const second = within(panel).getByRole("spinbutton", { name: /Secondo/ });
    fireEvent.change(second, { target: { value: "75" } });
    await user.click(within(panel).getByRole("button", { name: "Usa il momento 1:15" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /Copertina di/ })).not.toBeInTheDocument(),
    );
    expect(await server.requests.at(-1)?.json()).toEqual({ second: 75 });

    // Opened again, it says which moment it is, and can go back.
    await user.click(screen.getByRole("button", { name: "Copertina" }));
    const again = screen.getByRole("region", { name: "Copertina di Mare 2024" });
    expect(again).toHaveTextContent("il momento 1:15 del video");
    expect(within(again).getByRole("button", { name: "Torna a quella automatica" })).toBeVisible();
  });

  it("goes back to the cover FranzPLAY picks", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: { videos: [adminVideo({ coverChoice: "image" })], total: 1 },
      },
      "DELETE /api/admin/videos/7/cover": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(screen.getByRole("button", { name: "Copertina" }));
    const panel = screen.getByRole("region", { name: "Copertina di Mare 2024" });
    expect(panel).toHaveTextContent("un'immagine caricata da te");
    await user.click(within(panel).getByRole("button", { name: "Torna a quella automatica" }));
    await waitFor(() => expect(server.requests.at(-1)?.method).toBe("DELETE"));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Copertina scelta")).not.toBeInTheDocument();
  });

  it("says when the image is too large", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user, panel } = await openCover({
      "PUT /api/admin/videos/7/cover": { status: 413, body: { error: "too large" } },
    });
    fireEvent.change(within(panel).getByLabelText("Carica un'immagine"), {
      target: { files: [new File(["x"], "foto.png", { type: "image/png" })] },
    });
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Usa come copertina" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("troppo grande");
  });

  it("searches the internet and uses a picture found", async () => {
    const online = {
      youtube: false,
      tmdb: true,
      tpdb: true,
      tmdbKey: true,
      tpdbKey: false,
      rules: { from: 0, to: 0, daily: 0, order: ["youtube", "tmdb", "tpdb"] },
      askedToday: 0,
    };
    const { user, server, panel } = await openCover({
      "GET /api/online": { body: online },
      "GET /api/online/search": {
        body: {
          results: [
            {
              title: "Mare d'estate",
              date: "2024-07-01",
              author: "",
              picture: "/w1280/mare.jpg",
              thumb: "/w300/mare.jpg",
            },
            { title: "Senza foto", date: "", author: "", picture: "", thumb: "" },
          ],
        },
      },
      "GET /api/online/picture": () =>
        new Response("jpeg", { headers: { "Content-Type": "image/jpeg" } }),
      "PUT /api/admin/videos/7/cover": { status: 204 },
    });
    await user.click(within(panel).getByRole("button", { name: "Cerca su internet" }));
    // Only TMDB has its key: no choice of source.
    const words = await within(panel).findByRole("searchbox", { name: "Cosa cercare" });
    expect(words).toHaveValue("Mare 2024");
    expect(within(panel).queryByRole("combobox")).not.toBeInTheDocument();
    await user.clear(words);
    await user.type(words, "mare estate");
    await user.click(within(panel).getByRole("button", { name: "Cerca" }));

    const found = await within(panel).findByRole("list", { name: "Immagini trovate" });
    const search = new URL(server.requests.at(-1)?.url ?? "");
    expect(search.searchParams.get("source")).toBe("tmdb");
    expect(search.searchParams.get("q")).toBe("mare estate");
    const [first, second] = within(found).getAllByRole("button");
    expect(second).toBeDisabled();
    expect(first?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/online/picture?source=tmdb&at=%2Fw300%2Fmare.jpg",
    );

    await user.click(first as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Sistema la copertina" });
    expect(server.requests.some((r) => r.url.includes("at=%2Fw1280%2Fmare.jpg"))).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Usa come copertina" }));
    await waitFor(() => expect(server.requests.at(-1)?.method).toBe("PUT"));
    expect(server.requests.at(-1)?.url).toContain("/api/admin/videos/7/cover");
  });

  it("says how to turn a source on to search the internet", async () => {
    const off = {
      youtube: true,
      tmdb: false,
      tpdb: true,
      tmdbKey: true,
      tpdbKey: false,
      rules: { from: 0, to: 0, daily: 0, order: ["youtube", "tmdb", "tpdb"] },
      askedToday: 0,
    };
    const { user, panel } = await openCover({ "GET /api/online": { body: off } });
    await user.click(within(panel).getByRole("button", { name: "Cerca su internet" }));
    expect(await within(panel).findByText(/accendi TMDB o ThePornDB/)).toBeInTheDocument();
  });
});
