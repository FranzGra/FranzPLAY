import { screen, waitFor, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { emptyLibrary, renderApp, signedIn, testAccount } from "../../test/render";

const key = "abcdefghijklmnopqrstuv";
const giulia = { ...testAccount, id: 2, name: "Giulia", role: "user" as const };

function publicVideo(overrides: Record<string, unknown> = {}) {
  return {
    title: "Mare 2024",
    duration: 245,
    width: 1920,
    height: 1080,
    cover: `/api/public/${key}/cover`,
    preview: null,
    playable: true,
    fileType: "",
    copy: false,
    format: "MP4",
    author: "",
    publishedOn: null,
    description: "Una giornata al mare",
    owner: "Giulia",
    stream: `/api/public/${key}/stream`,
    ...overrides,
  };
}

function guest(openRegistration = false) {
  return {
    ...emptyLibrary,
    "GET /api/me": { status: 401, body: { error: "login required" } },
    "GET /api/setup": { body: { needed: false, codeNeeded: false, openRegistration } },
    [`GET /api/public/${key}`]: { body: publicVideo() },
    [`GET /api/public/${key}/subtitles`]: { body: [] },
  };
}

describe("public link button on the page of a video", () => {
  it("is not there without the permission, even on my own video", async () => {
    const { server } = renderApp("/video/7", {
      ...signedIn(giulia),
      "GET /api/videos/7": { body: videoJSON({ uploader: { id: 2, name: "Giulia" } }) },
    });
    await screen.findByRole("heading", { level: 1, name: "Mare 2024" });
    expect(screen.queryByRole("region", { name: "Link pubblico" })).not.toBeInTheDocument();
    expect(server.requests.some((r) => r.url.endsWith("/public-link"))).toBe(false);
  });

  it("is not there on someone else's video, even with the permission", async () => {
    renderApp("/video/7", {
      ...signedIn({ ...giulia, canSharePublic: true }),
      "GET /api/videos/7": { body: videoJSON({ uploader: { id: 3, name: "Anna" } }) },
      "GET /api/videos/7/public-link": { body: { link: null, createdAt: null } },
    });
    await screen.findByRole("heading", { level: 1, name: "Mare 2024" });
    expect(screen.queryByRole("region", { name: "Link pubblico" })).not.toBeInTheDocument();
  });

  it("makes, renews and turns off the link of my video with the permission", async () => {
    let made = 0;
    const { user, server } = renderApp("/video/7", {
      ...signedIn({ ...giulia, canSharePublic: true }),
      "GET /api/videos/7": { body: videoJSON({ uploader: { id: 2, name: "Giulia" } }) },
      "GET /api/videos/7/public-link": { body: { link: null, createdAt: null } },
      "POST /api/videos/7/public-link": () => {
        made++;
        const link = made === 1 ? `/p/${key}` : "/p/ZYXWVUTSRQPONMLKJIHGFE";
        return Response.json({ link, createdAt: "2026-10-15T10:00:00Z" });
      },
      "DELETE /api/videos/7/public-link": { status: 204 },
    });
    const panel = await screen.findByRole("region", { name: "Link pubblico" });
    await user.click(within(panel).getByRole("button", { name: "Crea link pubblico" }));
    expect(await within(panel).findByRole("textbox", { name: "Link del video" })).toHaveValue(
      `${window.location.origin}/p/${key}`,
    );
    await user.click(within(panel).getByRole("button", { name: "Rinnova link" }));
    await waitFor(() =>
      expect(within(panel).getByRole("textbox", { name: "Link del video" })).toHaveValue(
        `${window.location.origin}/p/ZYXWVUTSRQPONMLKJIHGFE`,
      ),
    );
    await user.click(within(panel).getByRole("button", { name: "Disattiva link" }));
    expect(
      await within(panel).findByRole("button", { name: "Crea link pubblico" }),
    ).toBeInTheDocument();
    expect(server.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });

  it("is there for an administrator, also on a video of the folders", async () => {
    renderApp("/video/7", {
      ...signedIn(),
      "GET /api/videos/7": { body: videoJSON() },
      "GET /api/videos/7/public-link": { body: { link: null, createdAt: null } },
    });
    expect(await screen.findByRole("region", { name: "Link pubblico" })).toBeInTheDocument();
  });
});

describe("page of a public link", () => {
  it("shows the video to a guest, with only its own addresses", async () => {
    const { server } = renderApp(`/p/${key}`, guest());
    expect(await screen.findByRole("heading", { level: 1, name: "Mare 2024" })).toBeInTheDocument();
    expect(document.querySelector("video")).toHaveAttribute("src", `/api/public/${key}/stream`);
    expect(screen.getByText("Condiviso da Giulia")).toBeInTheDocument();
    // Nothing of the library is asked.
    const asked = server.requests.map((r) => new URL(r.url).pathname);
    expect(asked.filter((p) => p.startsWith("/api/videos") || p === "/api/categories")).toEqual([]);
  });

  it("asks a guest to log in to like, save or comment, closed registration", async () => {
    const { user } = renderApp(`/p/${key}`, guest(false));
    await screen.findByRole("heading", { level: 1, name: "Mare 2024" });
    for (const name of ["Mi piace", "Salva", "Commenta"]) {
      const button = screen.getByRole("button", { name });
      await user.click(button);
      const dialog = screen.getByRole("dialog", { name: "Serve un account" });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveTextContent(
        "Per mettere Mi piace, commentare o salvare nelle tue playlist devi registrarti e accedere con il tuo account.",
      );
      expect(dialog).toHaveTextContent(/serve un invito/);
      expect(within(dialog).getByRole("button", { name: "Accedi" })).toHaveFocus();
      expect(within(dialog).queryByRole("button", { name: "Registrati" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    }
  });

  it("offers to register when anyone may, and goes back to the video", async () => {
    const { user } = renderApp(`/p/${key}`, guest(true));
    await screen.findByRole("heading", { level: 1, name: "Mare 2024" });
    await user.click(screen.getByRole("button", { name: "Mi piace" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent(/serve un invito/);
    await user.click(within(dialog).getByRole("button", { name: "Registrati" }));
    expect(await screen.findByRole("heading", { name: "Crea il tuo account" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Torna al video" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Mare 2024" })).toBeInTheDocument();
  });

  it("after logging in goes to the usual page of a video the person may open", async () => {
    let loggedIn = false;
    const { user } = renderApp(`/p/${key}`, {
      ...guest(),
      "GET /api/me": () =>
        loggedIn
          ? Response.json(giulia)
          : Response.json({ error: "login required" }, { status: 401 }),
      "POST /api/login/method": { body: { method: "password" } },
      "POST /api/login": () => {
        loggedIn = true;
        return Response.json(giulia);
      },
      [`GET /api/public/${key}`]: () =>
        Response.json(loggedIn ? publicVideo({ videoId: 7 }) : publicVideo()),
      "GET /api/videos/7": { body: videoJSON({ title: "Mare 2024 (pagina)" }) },
    });
    await screen.findByRole("heading", { level: 1, name: "Mare 2024" });
    await user.click(screen.getByRole("button", { name: "Commenta" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Accedi" }));
    await user.type(await screen.findByLabelText("Nome"), "Giulia");
    await user.click(screen.getByRole("button", { name: "Avanti" }));
    await user.type(await screen.findByLabelText("Password"), "giulia-password");
    await user.click(screen.getByRole("button", { name: "Entra" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Mare 2024 (pagina)" }),
    ).toBeInTheDocument();
  });

  it("says when the link does not work any more", async () => {
    renderApp(`/p/${key}`, {
      ...guest(),
      [`GET /api/public/${key}`]: { status: 404, body: { error: "video not found" } },
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Video non trovato" }),
    ).toBeInTheDocument();
  });
});
