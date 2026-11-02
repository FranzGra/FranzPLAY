import { screen } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

function orphan(overrides: Record<string, unknown> = {}) {
  return {
    ...videoJSON(),
    folder: "/media/video",
    path: "caricati/mare.mp4",
    hidden: false,
    missing: false,
    tooShort: false,
    foundTitle: "Mare 2024",
    foundCategory: "",
    titleSet: false,
    categorySet: false,
    coverChoice: "",
    coverSecond: null,
    clipChoice: "",
    videoCodec: "h264",
    audioCodec: "aac",
    hasCopy: false,
    private: true,
    uploader: null,
    ...overrides,
  };
}

async function open(video: Record<string, unknown>, routes: Record<string, unknown> = {}) {
  const app = renderApp("/admin/video/7", {
    ...signedIn(),
    "GET /api/admin/videos/7": { body: video },
    "GET /api/people": { body: [{ id: 2, name: "Marco", avatar: 0 }] },
    ...routes,
  });
  await screen.findByRole("heading", { level: 1, name: "Mare 2024" }, { timeout: 3000 });
  return app;
}

describe("a private video with no owner", () => {
  it("gets an owner chosen by the administrator", async () => {
    const { server, user } = await open(orphan(), {
      "PUT /api/admin/videos/7/audience": { status: 204 },
    });
    expect(screen.getByText(/Nessuno lo vede/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dagli questo proprietario" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Nuovo proprietario" }));
    expect(await screen.findByRole("option", { name: "Paolo (tu)" })).toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Marco" }));
    await user.click(screen.getByRole("button", { name: "Dagli questo proprietario" }));
    expect(await screen.findByText("Ora è di Marco.")).toBeInTheDocument();
    const sent = server.requests.find((r) => r.url.includes("/audience"));
    expect(await sent?.json()).toEqual({ owner: 2 });
  });

  it("can be opened to everybody", async () => {
    const { server, user } = await open(orphan(), {
      "PUT /api/admin/videos/7/audience": { status: 204 },
    });
    const sent = () => server.requests.filter((r) => r.url.includes("/audience"));
    await user.click(screen.getByRole("button", { name: "Aprilo a tutti" }));
    // It asks first: a private video opened by mistake cannot be closed for who saw it.
    await user.click(screen.getByRole("button", { name: "Annulla" }));
    expect(sent()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Aprilo a tutti" }));
    await user.click(screen.getByRole("button", { name: "Sì, aprilo" }));
    expect(await screen.findByText("Ora lo vedono tutti con un account.")).toBeInTheDocument();
    expect(await sent()[0]?.json()).toEqual({ everyone: true });
  });

  it("is not offered for a video with an owner", async () => {
    await open(orphan({ uploader: { id: 2, name: "Marco", avatar: 0 } }));
    expect(screen.queryByText(/Nessuno lo vede/)).not.toBeInTheDocument();
  });
});
