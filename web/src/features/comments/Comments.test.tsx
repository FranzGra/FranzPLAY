import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { fakeServer, type Routes } from "../../test/render";
import { Comments } from "./Comments";

const comment = (over: Record<string, unknown> = {}) => ({
  id: 1,
  author: { id: 2, name: "Giulia", avatar: 0 },
  body: "Che bello!",
  createdAt: new Date().toISOString(),
  canDelete: false,
  replies: [],
  ...over,
});

function setup(routes: Routes) {
  const server = fakeServer(routes);
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Comments videoId={7} />
    </MemoryRouter>,
  );
  return { user, server };
}

async function bodyOf(request: Request): Promise<unknown> {
  return JSON.parse(await request.clone().text());
}

describe("comments", () => {
  it("shows the author's photo, or their initial", async () => {
    setup({
      "GET /api/videos/7/comments": {
        body: [
          comment({ author: { id: 2, name: "Giulia", avatar: 9 } }),
          comment({ id: 3, author: { id: 4, name: "marco", avatar: 0 } }),
        ],
      },
    });
    const giulia = await screen.findByRole("article", { name: "Commento di Giulia" });
    expect(giulia.querySelector("img")).toHaveAttribute("src", "/api/users/2/avatar?v=9");
    const marco = screen.getByRole("article", { name: "Commento di marco" });
    expect(marco.querySelector("img")).toBeNull();
    expect(marco).toHaveTextContent(/^M/);
  });

  it("shows conversations with their replies", async () => {
    setup({
      "GET /api/videos/7/comments": {
        body: [
          comment({
            body: "Che bello!\nIl mare era perfetto",
            replies: [
              comment({ id: 2, author: { id: 3, name: "marco", avatar: 0 }, body: "Vero!" }),
            ],
          }),
        ],
      },
    });
    expect(await screen.findByRole("heading", { name: "2 commenti" })).toBeInTheDocument();
    const giulia = screen.getByRole("article", { name: "Commento di Giulia" });
    expect(within(giulia).getByText(/Il mare era perfetto/)).toBeInTheDocument();
    expect(within(giulia).getByText("adesso")).toBeInTheDocument();
    expect(within(giulia).getAllByRole("link", { name: "Giulia" })[0]).toHaveAttribute(
      "href",
      "/canale/2",
    );
    expect(within(giulia).queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
    const replies = screen.getByRole("list", { name: "Risposte a Giulia" });
    expect(within(replies).getByText("Vero!")).toBeInTheDocument();
    expect(within(replies).getByText("M")).toBeInTheDocument();
  });

  it("invites to write the first one", async () => {
    setup({ "GET /api/videos/7/comments": { body: [] } });
    expect(await screen.findByText(/Ancora nessun commento/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Commenti" })).toBeInTheDocument();
  });

  it("writes a comment", async () => {
    const { user, server } = setup({
      "GET /api/videos/7/comments": { body: [comment()] },
      "POST /api/videos/7/comments": {
        status: 201,
        body: comment({
          id: 5,
          author: { id: 1, name: "Paolo", avatar: 0 },
          body: "Ciao a tutti",
          canDelete: true,
        }),
      },
    });
    const box = await screen.findByRole("textbox", { name: "Aggiungi un commento" });
    expect(screen.queryByRole("button", { name: "Commenta" })).not.toBeInTheDocument();
    await user.type(box, "Ciao a tutti");
    await user.click(screen.getByRole("button", { name: "Commenta" }));

    const articles = await screen.findAllByRole("article");
    expect(articles[0]).toHaveAccessibleName("Commento di Paolo");
    expect(box).toHaveValue("");
    expect(screen.getByRole("heading", { name: "2 commenti" })).toBeInTheDocument();
    const post = server.requests.find((r) => r.method === "POST");
    expect(post && (await bodyOf(post))).toEqual({ body: "Ciao a tutti" });
  });

  it("answers a reply under the same conversation", async () => {
    const { user, server } = setup({
      "GET /api/videos/7/comments": {
        body: [
          comment({ replies: [comment({ id: 2, author: { id: 3, name: "Marco", avatar: 0 } })] }),
        ],
      },
      "POST /api/videos/7/comments": {
        status: 201,
        body: comment({
          id: 9,
          author: { id: 1, name: "Paolo", avatar: 0 },
          body: "Anche per me",
        }),
      },
    });
    const marco = await screen.findByRole("article", { name: "Commento di Marco" });
    await user.click(within(marco).getByRole("button", { name: "Rispondi" }));
    const box = screen.getByRole("textbox", { name: "Rispondi a Giulia" });
    expect(box).toHaveFocus();
    await user.type(box, "Anche per me{Control>}{Enter}{/Control}");

    const replies = screen.getByRole("list", { name: "Risposte a Giulia" });
    expect(await within(replies).findByText("Anche per me")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Rispondi a Giulia" })).not.toBeInTheDocument();
    const post = server.requests.find((r) => r.method === "POST");
    expect(post && (await bodyOf(post))).toEqual({ body: "Anche per me", parentId: 1 });
  });

  it("deletes a comment after asking", async () => {
    const { user, server } = setup({
      "GET /api/videos/7/comments": {
        body: [comment({ canDelete: true, replies: [comment({ id: 2 })] }), comment({ id: 3 })],
      },
      "DELETE /api/comments/1": { status: 204 },
    });
    expect(await screen.findByRole("heading", { name: "3 commenti" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Elimina" }));
    expect(screen.getByText("Eliminare il commento e le sue risposte?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sì, elimina" }));

    expect(await screen.findByRole("heading", { name: "1 commento" })).toBeInTheDocument();
    expect(server.requests.at(-1)?.method).toBe("DELETE");
  });

  it("keeps the text when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = setup({
      "GET /api/videos/7/comments": { body: [] },
      "POST /api/videos/7/comments": { status: 500, body: { error: "internal error" } },
    });
    const box = await screen.findByRole("textbox", { name: "Aggiungi un commento" });
    await user.type(box, "Non perderlo");
    await user.click(screen.getByRole("button", { name: "Commenta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Non sono riuscito a pubblicare");
    expect(box).toHaveValue("Non perderlo");
  });

  it("says when the comments do not load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ "GET /api/videos/7/comments": { status: 500, body: { error: "internal error" } } });
    expect(await screen.findByText(/Non sono riuscito a caricare i commenti/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
