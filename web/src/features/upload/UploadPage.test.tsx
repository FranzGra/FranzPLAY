import { screen, within } from "@testing-library/react";
import { renderApp, signedIn, testAccount } from "../../test/render";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const gb = 1024 ** 3;
const space = { quota: 10 * gb, used: 2 * gb, reserved: 0 };

function uploads(extra: Record<string, unknown> = {}, list: unknown[] = []) {
  return {
    ...signedIn(),
    "GET /api/uploads": { body: { space, uploads: list } },
    "GET /api/uploads/videos": { body: [] },
    ...extra,
  };
}

const video = (name: string, content: string) => new File([content], name, { type: "video/mp4" });

describe("upload page", () => {
  it("tells who may not upload whom to ask", async () => {
    renderApp("/carica", signedIn({ ...testAccount, canUpload: false }));
    expect(await screen.findByRole("heading", { name: "Caricare video" })).toBeInTheDocument();
    expect(screen.getByText(/serve il permesso dell'amministratore/)).toBeInTheDocument();
  });

  it("shows the space used", async () => {
    renderApp("/carica", uploads());
    expect(await screen.findByText("Hai usato 2 GB di 10 GB.")).toBeInTheDocument();
  });

  it("uploads a video and links to it", async () => {
    let received = 0;
    const { user, server } = renderApp(
      "/carica",
      uploads({
        "POST /api/uploads": {
          status: 201,
          body: { id: 4, name: "mare.mp4", title: "Al mare", size: 5, received: 0, private: true },
        },
        "PUT /api/uploads/4": async (request: Request) => {
          received += (await request.text()).length;
          return json({
            id: 4,
            name: "mare.mp4",
            title: "Al mare",
            size: 5,
            received,
            private: true,
            video: 12,
          });
        },
      }),
    );
    await user.upload(await screen.findByLabelText(/Scegli un video/), video("mare.mp4", "abcde"));
    const title = screen.getByLabelText("Titolo");
    expect(title).toHaveValue("mare");
    await user.clear(title);
    await user.type(title, "Al mare");
    expect(screen.getByRole("radio", { name: "Tutti" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Solo io" }));
    expect(screen.getByText(/Non compare nelle liste di nessuno/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Carica" }));

    expect(await screen.findByRole("link", { name: "Guarda il video" })).toHaveAttribute(
      "href",
      "/video/12",
    );
    const start = server.requests.find((r) => r.method === "POST");
    expect(await start?.json()).toEqual({
      name: "mare.mp4",
      title: "Al mare",
      size: 5,
      private: true,
      sharedWith: [],
    });
    expect(received).toBe(5);
  });

  it("says when there is not enough space, before sending anything", async () => {
    const { user, server } = renderApp("/carica", uploads({}, []));
    const big = video("film.mp4", "x");
    Object.defineProperty(big, "size", { value: 9 * gb });
    await user.upload(await screen.findByLabelText(/Scegli un video/), big);
    await user.click(screen.getByRole("button", { name: "Carica" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Questo video è di 9 GB, ma ti restano 8 GB.",
    );
    expect(server.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("goes on with an upload left half way", async () => {
    const half = {
      id: 4,
      name: "mare.mp4",
      title: "Al mare",
      size: 6,
      received: 3,
      private: false,
    };
    const offsets: string[] = [];
    const { user } = renderApp(
      "/carica",
      uploads(
        {
          "PUT /api/uploads/4": (request: Request) => {
            offsets.push(new URL(request.url).searchParams.get("offset") ?? "");
            return json({ ...half, received: 6, video: 12 });
          },
        },
        [half],
      ),
    );
    const list = await screen.findByRole("region", { name: "Caricamenti a metà" });
    expect(within(list).getByText(/fermo al 50%/)).toBeInTheDocument();

    // Another file is refused.
    await user.upload(within(list).getByLabelText("Continua"), video("altro.mp4", "abcdef"));
    expect(within(list).getByRole("alert")).toHaveTextContent("Non è lo stesso file");

    await user.upload(within(list).getByLabelText("Continua"), video("mare.mp4", "abcdef"));
    expect(await screen.findByRole("link", { name: "Guarda il video" })).toBeInTheDocument();
    expect(offsets).toEqual(["3"]);
  });

  it("cancels an upload left half way", async () => {
    const half = {
      id: 4,
      name: "mare.mp4",
      title: "Al mare",
      size: 6,
      received: 3,
      private: false,
    };
    const { user, server } = renderApp(
      "/carica",
      uploads({ "DELETE /api/uploads/4": { status: 204 } }, [half]),
    );
    const list = await screen.findByRole("region", { name: "Caricamenti a metà" });
    await user.click(within(list).getByRole("button", { name: "Annulla" }));
    expect(server.requests.some((r) => r.method === "DELETE")).toBe(true);
  });

  it("explains a video already on FranzPLAY", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp(
      "/carica",
      uploads({
        "POST /api/uploads": {
          status: 201,
          body: { id: 4, name: "mare.mp4", title: "mare", size: 5, received: 0, private: false },
        },
        "PUT /api/uploads/4": {
          status: 409,
          body: { error: "this video is already on FranzPLAY" },
        },
      }),
    );
    await user.upload(await screen.findByLabelText(/Scegli un video/), video("mare.mp4", "abcde"));
    await user.click(screen.getByRole("button", { name: "Carica" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Questo video c'è già su FranzPLAY.",
    );
    expect(screen.getByRole("button", { name: "Carica un altro video" })).toBeInTheDocument();
  });

  it("says where my videos will appear", async () => {
    renderApp("/carica", uploads());
    const mine = await screen.findByRole("region", { name: "I tuoi video" });
    expect(
      await within(mine).findByText(/Qui compariranno i video che carichi/),
    ).toBeInTheDocument();
  });

  const mare = {
    id: 12,
    title: "Al mare",
    size: 3 * 1024 ** 2,
    addedAt: "2026-10-12T20:00:00Z",
    cover: "/api/covers/12.jpg",
    hidden: false,
    private: false,
    sharedWith: [],
  };

  it("lists my videos and renames one", async () => {
    const { user, server } = renderApp(
      "/carica",
      uploads({
        "GET /api/uploads/videos": {
          body: [mare, { ...mare, id: 13, title: "Lago", hidden: true }],
        },
        "PUT /api/uploads/videos/12": { body: { ...mare, title: "Al mare d'estate" } },
      }),
    );
    const mine = await screen.findByRole("region", { name: "I tuoi video" });
    expect(await within(mine).findByRole("link", { name: "Al mare" })).toHaveAttribute(
      "href",
      "/video/12",
    );
    expect(within(mine).getByText(/12 ottobre 2026 · 3 MB · lo vedono tutti$/)).toBeInTheDocument();
    expect(within(mine).getByText(/nascosto dall'amministratore/)).toBeInTheDocument();

    await user.click(
      within(mine).getAllByRole("button", { name: "Cambia titolo" })[0] as HTMLElement,
    );
    const title = within(mine).getByLabelText("Titolo");
    await user.clear(title);
    await user.type(title, "Al mare d'estate");
    await user.click(within(mine).getByRole("button", { name: "Salva" }));
    expect(await within(mine).findByRole("link", { name: "Al mare d'estate" })).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({ title: "Al mare d'estate" });
  });

  const people = [
    { id: 3, name: "Anna", avatar: 0 },
    { id: 4, name: "Marco", avatar: 0 },
  ];

  it("keeps one of my videos only for me", async () => {
    const { user, server } = renderApp(
      "/carica",
      uploads({
        "GET /api/uploads/videos": { body: [mare] },
        "PUT /api/uploads/videos/12": { body: { ...mare, private: true } },
      }),
    );
    const mine = await screen.findByRole("region", { name: "I tuoi video" });
    expect(await within(mine).findByText(/lo vedono tutti/)).toBeInTheDocument();
    await user.click(within(mine).getByRole("button", { name: "Chi lo vede" }));
    await user.click(within(mine).getByRole("radio", { name: "Solo io" }));
    await user.click(within(mine).getByRole("button", { name: "Salva" }));
    expect(await within(mine).findByText(/solo tu lo vedi/)).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({ private: true, sharedWith: [] });
  });

  it("shares one of my videos with some people", async () => {
    const { user, server } = renderApp(
      "/carica",
      uploads({
        "GET /api/uploads/videos": { body: [mare] },
        "GET /api/people": { body: people },
        "PUT /api/uploads/videos/12": {
          body: { ...mare, private: true, sharedWith: [people[1]] },
        },
      }),
    );
    const mine = await screen.findByRole("region", { name: "I tuoi video" });
    await user.click(await within(mine).findByRole("button", { name: "Chi lo vede" }));
    await user.click(within(mine).getByRole("radio", { name: "Alcune persone" }));
    // Nobody chosen yet: nothing is sent.
    await user.click(await within(mine).findByRole("checkbox", { name: "Marco" }));
    await user.click(within(mine).getByRole("checkbox", { name: "Marco" }));
    await user.click(within(mine).getByRole("button", { name: "Salva" }));
    expect(within(mine).getByRole("alert")).toHaveTextContent("Scegli almeno una persona");
    expect(server.requests.some((r) => r.method === "PUT")).toBe(false);

    await user.click(within(mine).getByRole("checkbox", { name: "Marco" }));
    await user.click(within(mine).getByRole("button", { name: "Salva" }));
    expect(await within(mine).findByText(/lo vedono anche Marco$/)).toBeInTheDocument();
    expect(await server.requests.at(-1)?.json()).toEqual({ private: true, sharedWith: [4] });
  });

  it("chooses the people when uploading", async () => {
    const { user, server } = renderApp(
      "/carica",
      uploads({
        "GET /api/people": { body: people },
        "POST /api/uploads": {
          status: 201,
          body: { id: 4, name: "mare.mp4", title: "mare", size: 5, received: 0, private: true },
        },
        "PUT /api/uploads/4": {
          body: {
            id: 4,
            name: "mare.mp4",
            title: "mare",
            size: 5,
            received: 5,
            private: true,
            video: 12,
          },
        },
      }),
    );
    await user.upload(await screen.findByLabelText(/Scegli un video/), video("mare.mp4", "abcde"));
    await user.click(screen.getByRole("radio", { name: "Alcune persone" }));
    expect(screen.getByText(/nella pagina «Condivisi con te»/)).toBeInTheDocument();
    await user.click(await screen.findByRole("checkbox", { name: "Anna" }));
    await user.click(screen.getByRole("button", { name: "Carica" }));
    expect(await screen.findByRole("link", { name: "Guarda il video" })).toBeInTheDocument();
    const start = server.requests.find((r) => r.method === "POST");
    expect(await start?.json()).toEqual({
      name: "mare.mp4",
      title: "mare",
      size: 5,
      private: true,
      sharedWith: [3],
    });
  });

  it("deletes one of my videos after asking", async () => {
    const { user, server } = renderApp(
      "/carica",
      uploads({
        "GET /api/uploads/videos": { body: [mare] },
        "DELETE /api/uploads/videos/12": { status: 204 },
      }),
    );
    const mine = await screen.findByRole("region", { name: "I tuoi video" });
    await user.click(await within(mine).findByRole("button", { name: "Elimina" }));
    expect(within(mine).getByText(/Non si può annullare/)).toBeInTheDocument();
    await user.click(within(mine).getByRole("button", { name: "Sì, elimina" }));
    expect(await within(mine).findByText(/Qui compariranno/)).toBeInTheDocument();
    expect(server.requests.some((r) => r.method === "DELETE")).toBe(true);
  });
});
