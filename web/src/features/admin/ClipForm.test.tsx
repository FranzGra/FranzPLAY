import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

function adminVideo(overrides: Record<string, unknown> = {}) {
  return {
    ...videoJSON(),
    folder: "/media/video",
    path: "Vacanze/Mare 2024.mp4",
    hidden: false,
    missing: false,
    tooShort: false,
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

async function openClip(video: Record<string, unknown>, routes: Record<string, unknown>) {
  const app = renderApp("/admin/video/7", {
    ...signedIn(),
    "GET /api/admin/videos/7": { body: video },
    ...routes,
  });
  await screen.findByRole("heading", { level: 1, name: "Mare 2024" }, { timeout: 3000 });
  return { ...app, panel: screen.getByRole("region", { name: "Anteprima di Mare 2024" }) };
}

describe("choosing a clip", () => {
  it("uploads a short video of one's own", async () => {
    const { server, panel } = await openClip(adminVideo(), {
      "PUT /api/admin/videos/7/clip": { status: 204 },
    });
    expect(panel).toHaveTextContent("Pochi secondi presi da momenti diversi");
    const file = new File(["mp4"], "mio.mp4", { type: "video/mp4" });
    fireEvent.change(within(panel).getByLabelText("Carica un video"), {
      target: { files: [file] },
    });
    expect(await screen.findByText(/l'anteprima nuova arriva/)).toBeInTheDocument();
    const sent = server.requests.at(-1);
    expect(sent?.url).toContain("/api/admin/videos/7/clip");
    expect(sent?.headers.get("Content-Type")).toBe("video/mp4");
    expect(within(panel).getByText("Caricata da te")).toHaveAttribute("aria-current", "true");
  });

  it("refuses a video too large before sending it", async () => {
    const { server, panel } = await openClip(adminVideo(), {});
    const file = new File(["x"], "film.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 });
    fireEvent.change(within(panel).getByLabelText("Carica un video"), {
      target: { files: [file] },
    });
    expect(within(panel).getByRole("alert")).toHaveTextContent("troppo grande");
    expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("removes the clip, and makes it again", async () => {
    const { user, server, panel } = await openClip(adminVideo(), {
      "DELETE /api/admin/videos/7/clip": { status: 204 },
      "POST /api/admin/videos/7/clip/remake": { status: 204 },
    });
    await user.click(within(panel).getByRole("button", { name: "Nessuna anteprima" }));
    expect(await screen.findByText(/niente anteprima/)).toBeInTheDocument();
    expect(within(panel).getByText("Senza anteprima")).toBeInTheDocument();
    expect(server.requests.at(-1)?.method).toBe("DELETE");

    const again = screen.getByRole("region", { name: "Anteprima di Mare 2024" });
    expect(again).toHaveTextContent("non ha anteprima");
    expect(within(again).queryByRole("button", { name: "Nessuna anteprima" })).toBeNull();
    await user.click(within(again).getByRole("button", { name: "Rifalla dal video" }));
    await waitFor(() => expect(server.requests.at(-1)?.url).toContain("/clip/remake"));
    expect(await screen.findByText(/rifà l'anteprima/)).toBeInTheDocument();
    expect(within(again).queryByText("Senza anteprima")).not.toBeInTheDocument();
  });

  it("says when the file is not a video", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { panel } = await openClip(adminVideo(), {
      "PUT /api/admin/videos/7/clip": { status: 415, body: { error: "not a clip" } },
    });
    fireEvent.change(within(panel).getByLabelText("Carica un video"), {
      target: { files: [new File(["x"], "a.mp4", { type: "video/mp4" })] },
    });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("non è un video MP4 o WebM");
  });
});
