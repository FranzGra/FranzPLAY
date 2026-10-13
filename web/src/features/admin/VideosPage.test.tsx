import { act, screen, within } from "@testing-library/react";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

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

function rowOf(name: string) {
  const list = screen.getByRole("list", { name: "Video" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByText(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("videos page", () => {
  it("shows how sharp each video is and whether every browser plays it", async () => {
    renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [
            adminVideo(),
            adminVideo({ id: 8, title: "Film", height: 2160, playable: false, format: "MKV" }),
          ],
          total: 2,
        },
      },
    });
    await screen.findByRole("list", { name: "Video" });
    expect(rowOf("Mare 2024")).toHaveTextContent("1080p");
    expect(rowOf("Mare 2024")).toHaveTextContent("Va su tutti i browser");
    expect(rowOf("Film")).toHaveTextContent("4K");
    expect(rowOf("Film")).toHaveTextContent("Non va su tutti i browser");
  });

  it("shows the videos as a table, and remembers it", async () => {
    const routes = {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [adminVideo(), adminVideo({ id: 8, title: "Film", hidden: true, hasCopy: true })],
          total: 2,
        },
      },
    };
    const { user, unmount } = renderApp("/admin/video", routes);
    await screen.findByRole("list", { name: "Video" });
    await user.click(screen.getByRole("button", { name: "Tabella" }));
    const table = screen.getByRole("table", { name: "Video" });
    const film = within(table).getByRole("row", { name: /Film/ });
    expect(film).toHaveTextContent("Nascosto");
    expect(film).toHaveTextContent("Copia per tutti i browser");
    expect(film).toHaveTextContent("MP4 · h264 · aac");
    expect(within(table).getByRole("link", { name: "Mare 2024" })).toHaveAttribute(
      "href",
      "/video/7",
    );
    unmount();

    renderApp("/admin/video", routes);
    expect(await screen.findByRole("table", { name: "Video" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tabella" })).toHaveAttribute("aria-pressed", "true");
  });

  it("changes the title and category of a video", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
      "GET /api/categories": { body: [{ name: "Viaggi", videos: 3, color: "", image: null }] },
      "PUT /api/admin/videos/7/details": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Modifica" }));
    // The categories in use are offered while typing.
    await vi.waitFor(() =>
      expect(document.querySelector('#admin-categories option[value="Viaggi"]')).not.toBeNull(),
    );
    const form = screen.getByRole("form", { name: "Modifica Mare 2024" });
    const title = within(form).getByRole("textbox", { name: /Titolo/ });
    await user.clear(title);
    await user.type(title, "Al mare con la nonna");
    expect(within(form).getByText(/Trovato da FranzPLAY: «Mare 2024»/)).toBeInTheDocument();
    const category = within(form).getByRole("combobox", { name: /Categoria/ });
    await user.clear(category);
    await user.type(category, "Viaggi");
    await user.click(within(form).getByRole("button", { name: "Salva" }));

    expect(await within(rowOf("Al mare con la nonna")).findByRole("status")).toHaveTextContent(
      "Salvato.",
    );
    expect(rowOf("Al mare con la nonna")).toHaveTextContent("Viaggi · Vacanze/Mare 2024.mp4");
    expect(await server.requests.at(-1)?.json()).toEqual({
      title: "Al mare con la nonna",
      category: "Viaggi",
    });
  });

  it("puts back the title and category FranzPLAY found", async () => {
    const changed = adminVideo({
      title: "Al mare",
      category: "",
      titleSet: true,
      categorySet: true,
    });
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [changed], total: 1 } },
      "PUT /api/admin/videos/7/details": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Al mare")).getByRole("button", { name: "Modifica" }));
    const form = screen.getByRole("form", { name: "Modifica Al mare" });
    await user.click(within(form).getByRole("button", { name: "Rimetti questo" }));
    await user.click(within(form).getByRole("button", { name: "Rimetti questa" }));
    await user.click(within(form).getByRole("button", { name: "Salva" }));
    expect(await within(rowOf("Mare 2024")).findByRole("status")).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({ title: null, category: null });
  });

  it("refuses an empty title", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Modifica" }));
    const form = screen.getByRole("form", { name: "Modifica Mare 2024" });
    await user.clear(within(form).getByRole("textbox", { name: /Titolo/ }));
    await user.click(within(form).getByRole("button", { name: "Salva" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Il titolo deve avere");
    expect(server.requests.some((r) => r.url.includes("/details"))).toBe(false);
  });

  it("lists every video with its file and state", async () => {
    renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [
            adminVideo(),
            adminVideo({ id: 8, title: "Segreto", hidden: true }),
            adminVideo({ id: 9, title: "Perso", missing: true, duration: null, cover: null }),
          ],
          total: 3,
        },
      },
    });
    await screen.findByRole("list", { name: "Video" });
    expect(rowOf("Mare 2024")).toHaveTextContent("Vacanze/Mare 2024.mp4");
    expect(within(rowOf("Mare 2024")).getByRole("link", { name: "Mare 2024" })).toHaveAttribute(
      "href",
      "/video/7",
    );
    expect(rowOf("Segreto")).toHaveTextContent("Nascosto");
    expect(within(rowOf("Segreto")).getByRole("button", { name: "Mostra" })).toBeInTheDocument();
    expect(rowOf("Perso")).toHaveTextContent("Non trovato");
    expect(rowOf("Perso")).toHaveTextContent("Non ancora letto");
    expect(within(rowOf("Perso")).getByRole("button", { name: "Rifai copertina" })).toBeDisabled();
    expect(screen.getByText("3 video")).toBeInTheDocument();
  });

  it("says who uploaded a video and when only they see it", async () => {
    renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": {
        body: {
          videos: [
            adminVideo({
              title: "Al mare",
              folder: "/data/uploads",
              path: "5/3.mp4",
              private: true,
              uploader: { id: 5, name: "Giulia" },
            }),
          ],
          total: 1,
        },
      },
    });
    const row = await screen.findByRole("listitem");
    expect(within(row).getByText(/Caricato da Giulia/)).toBeInTheDocument();
    expect(within(row).getByText("Solo per chi l'ha caricato")).toBeInTheDocument();
    // The administrator cannot open it: no link to a page that would not open.
    expect(within(row).queryByRole("link", { name: "Al mare" })).not.toBeInTheDocument();
  });

  it("searches and filters", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(screen.getByRole("button", { name: "Nascosti" }));
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("show=hidden"));
    await user.type(screen.getByRole("searchbox", { name: "Cerca tra i video" }), "mare{Enter}");
    await vi.waitFor(() => expect(server.requests.at(-1)?.url).toContain("q=mare"));
    expect(server.requests.at(-1)?.url).toContain("show=hidden");
  });

  it("hides a video and shows it again", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
      "PUT /api/admin/videos/7/hidden": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Nascondi" }));
    expect(await within(rowOf("Mare 2024")).findByRole("status")).toHaveTextContent(
      "Nascosto a tutti.",
    );
    expect(await server.requests.at(-1)?.json()).toEqual({ hidden: true });

    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Mostra" }));
    expect(await within(rowOf("Mare 2024")).findByRole("status")).toHaveTextContent(
      "Di nuovo visibile a tutti.",
    );
    expect(await server.requests.at(-1)?.json()).toEqual({ hidden: false });
  });

  it("has the cover made again", async () => {
    const { user, server } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
      "POST /api/admin/videos/7/refresh": { status: 204 },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Rifai copertina" }));
    expect(await within(rowOf("Mare 2024")).findByRole("status")).toHaveTextContent("In coda");
    expect(server.requests.at(-1)?.method).toBe("POST");
  });

  it("says when an action fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": { body: { videos: [adminVideo()], total: 1 } },
      "PUT /api/admin/videos/7/hidden": { status: 500, body: { error: "internal error" } },
    });
    await screen.findByRole("list", { name: "Video" });
    await user.click(within(rowOf("Mare 2024")).getByRole("button", { name: "Nascondi" }));
    expect(await within(rowOf("Mare 2024")).findByRole("alert")).toBeInTheDocument();
    expect(
      within(rowOf("Mare 2024")).getByRole("button", { name: "Nascondi" }),
    ).toBeInTheDocument();
  });

  it("follows the library as it changes", async () => {
    stubEventSource();
    let videos = [adminVideo()];
    renderApp("/admin/video", {
      ...signedIn(),
      "GET /api/admin/videos": () => new Response(JSON.stringify({ videos, total: videos.length })),
    });
    await screen.findByRole("list", { name: "Video" });
    videos = [adminVideo({ id: 10, title: "Nuovo" }), ...videos];
    act(() => FakeEventSource.last?.emit("library"));
    expect(await screen.findByText("Nuovo")).toBeInTheDocument();
  });
});
