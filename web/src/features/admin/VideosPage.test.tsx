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
