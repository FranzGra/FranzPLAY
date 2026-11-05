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

describe("choosing where the clip starts", () => {
  const site = { "GET /api/admin/clip-settings": { body: { startPercent: 0, seconds: 6 } } };

  it("makes the clip again from the moment stopped on the slider, as long as chosen", async () => {
    const { user, server, panel } = await openClip(adminVideo(), {
      ...site,
      "PUT /api/admin/videos/7/clip/moment": { status: 204 },
    });
    await user.click(within(panel).getByRole("button", { name: "Scegli il momento" }));
    expect(
      screen.getByLabelText("Il video: fermalo dove deve partire l'anteprima"),
    ).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Inizio dell'anteprima" });
    // Up to the last second of the video: a clip needs something to show.
    expect(slider).toHaveAttribute("max", "244");
    fireEvent.change(slider, { target: { value: "90" } });
    const length = screen.getByRole("spinbutton", { name: "Durata (secondi)" });
    expect(length).toHaveValue(6);
    fireEvent.change(length, { target: { value: "8" } });
    await user.click(screen.getByRole("button", { name: "Rigenera anteprima da qui" }));

    expect(
      await screen.findByText(/l'anteprima riparte da 1:30 e dura 8 secondi/),
    ).toBeInTheDocument();
    const sent = server.requests.at(-1);
    expect(sent?.url).toContain("/api/admin/videos/7/clip/moment");
    expect(await sent?.json()).toEqual({ second: 90, seconds: 8 });
    expect(screen.getByRole("region", { name: "Anteprima di Mare 2024" })).toHaveTextContent(
      "a partire da 1:30, per 8 secondi",
    );
  });

  it("keeps the site's length when it is not changed, so it follows the site", async () => {
    const { user, server, panel } = await openClip(adminVideo(), {
      ...site,
      "PUT /api/admin/videos/7/clip/moment": { status: 204 },
    });
    await user.click(within(panel).getByRole("button", { name: "Scegli il momento" }));
    fireEvent.change(screen.getByRole("slider", { name: "Inizio dell'anteprima" }), {
      target: { value: "12" },
    });
    await user.click(screen.getByRole("button", { name: "Rigenera anteprima da qui" }));
    await screen.findByText(/l'anteprima riparte da 0:12 e dura 6 secondi/);
    expect(await server.requests.at(-1)?.json()).toEqual({ second: 12, seconds: null });
  });

  it("refuses a length the clips cannot have", async () => {
    const { user, server, panel } = await openClip(adminVideo(), site);
    await user.click(within(panel).getByRole("button", { name: "Scegli il momento" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Durata (secondi)" }), {
      target: { value: "40" },
    });
    await user.click(screen.getByRole("button", { name: "Rigenera anteprima da qui" }));
    expect(screen.getByText("Scegli una durata tra 2 e 30 secondi.")).toBeInTheDocument();
    expect(server.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("goes back to the site's clip", async () => {
    const { user, server, panel } = await openClip(
      adminVideo({ clipSecond: 42, clipSeconds: 10 }),
      {
        ...site,
        "PUT /api/admin/videos/7/clip/moment": { status: 204 },
      },
    );
    expect(panel).toHaveTextContent("a partire da 0:42, per 10 secondi: scelto da te");
    await user.click(within(panel).getByRole("button", { name: "Torna come le altre" }));
    expect(await screen.findByText(/torna come quelle del sito/)).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({ second: null, seconds: null });
    expect(
      within(screen.getByRole("region", { name: "Anteprima di Mare 2024" })).queryByRole("button", {
        name: "Torna come le altre",
      }),
    ).toBeNull();
  });
});
