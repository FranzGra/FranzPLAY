import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

const youtubeOn = {
  youtube: true,
  tmdb: false,
  tpdb: false,
  tmdbKey: false,
  tpdbKey: false,
  rules: { from: 0, to: 0, daily: 0, order: ["youtube", "tmdb", "tpdb"], confirm: false },
  askedToday: 0,
  proposals: 0,
};

const confirming = { ...youtubeOn, rules: { ...youtubeOn.rules, confirm: true } };

const proposal = (videoId: number, video: string) => ({
  videoId,
  video,
  source: "youtube",
  title: `Titolo per ${video}`,
  author: "Famiglia Rossi",
  date: "",
  description: "",
  picture: true,
});

describe("confirming what the internet found", () => {
  it("turns the confirm mode on", async () => {
    const { user, server } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: youtubeOn },
      "PUT /api/online/rules": { body: confirming },
      "GET /api/online/proposals": { body: { proposals: [] } },
    });
    const form = await screen.findByRole("form", { name: "Regole" });
    expect(screen.queryByRole("region", { name: "Da confermare" })).not.toBeInTheDocument();

    await user.click(
      within(form).getByRole("checkbox", {
        name: "Chiedi conferma prima di usare quello che trova",
      }),
    );
    await user.click(within(form).getByRole("button", { name: "Salva le regole" }));
    const waiting = await screen.findByRole("region", { name: "Da confermare" });
    expect(await within(waiting).findByText(/Niente da confermare/)).toBeInTheDocument();
    const saved = server.requests.find((r) => r.method === "PUT");
    expect(await saved?.json()).toEqual(confirming.rules);
  });

  it("uses one proposal and throws another away", async () => {
    const { user, server } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: { ...confirming, proposals: 2 } },
      "GET /api/online/proposals": {
        body: { proposals: [proposal(7, "Gita"), proposal(8, "Mare")] },
      },
      "POST /api/online/proposals/7": { status: 204 },
      "DELETE /api/online/proposals/8": { status: 204 },
    });
    const list = await screen.findByRole("list", { name: "Proposte" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Titolo per Gita");
    expect(items[0]).toHaveTextContent("Per «Gita», da YouTube · Famiglia Rossi");
    expect(items[0]?.querySelector("img")).toHaveAttribute(
      "src",
      "/api/online/proposals/7/picture",
    );

    await user.click(screen.getByRole("button", { name: "Usa la proposta per Gita" }));
    expect(server.requests.at(-1)?.method).toBe("POST");
    expect(
      await screen.findByRole("button", { name: "Scarta la proposta per Mare" }),
    ).toBeEnabled();
    expect(screen.queryByText("Titolo per Gita")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Scarta la proposta per Mare" }));
    expect(await screen.findByText(/Niente da confermare/)).toBeInTheDocument();
    expect(server.requests.at(-1)?.method).toBe("DELETE");
  });

  it("shows proposals left after the confirm mode was turned off", async () => {
    renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: { ...youtubeOn, proposals: 1 } },
      "GET /api/online/proposals": { body: { proposals: [proposal(7, "Gita")] } },
    });
    expect(await screen.findByRole("button", { name: "Usa la proposta per Gita" })).toBeEnabled();
  });

  it("says when the choice was not saved", async () => {
    const { user } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: { ...confirming, proposals: 1 } },
      "GET /api/online/proposals": { body: { proposals: [proposal(7, "Gita")] } },
      "POST /api/online/proposals/7": { status: 500, body: { error: "boom" } },
    });
    await user.click(await screen.findByRole("button", { name: "Usa la proposta per Gita" }));
    const waiting = screen.getByRole("region", { name: "Da confermare" });
    expect(await within(waiting).findByRole("alert")).toHaveTextContent("Non si è riusciti");
    expect(screen.getByText("Titolo per Gita")).toBeInTheDocument();
  });
});
