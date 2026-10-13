import { screen, waitFor, within } from "@testing-library/react";
import { videoJSON, watchedJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

const started = [
  watchedJSON({ video: videoJSON({ id: 3, title: "Primo", duration: 200 }), position: 50 }),
  watchedJSON({ video: videoJSON({ id: 4, title: "Secondo", duration: 200 }), position: 80 }),
];

function titles(row: HTMLElement) {
  return within(within(row).getByRole("list"))
    .getAllByRole("heading")
    .map((h) => h.textContent);
}

describe("continue watching", () => {
  it("takes a video out of the row, keeping the others", async () => {
    const { user, server } = renderApp("/", {
      ...signedIn(),
      "GET /api/continue": { body: started },
      "DELETE /api/continue/3": { status: 204 },
    });
    const row = await screen.findByRole("region", { name: "Continua a guardare" });
    await user.click(
      within(row).getByRole("button", { name: "Togli «Primo» da Continua a guardare" }),
    );
    await waitFor(() => expect(titles(row)).toEqual(["Secondo"]));
    expect(
      server.requests.some((r) => r.method === "DELETE" && r.url.endsWith("/continue/3")),
    ).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides the row once the last video is taken out", async () => {
    const { user } = renderApp("/", {
      ...signedIn(),
      "GET /api/continue": { body: [started[0]] },
      "DELETE /api/continue/3": { status: 204 },
    });
    const row = await screen.findByRole("region", { name: "Continua a guardare" });
    await user.click(within(row).getByRole("button", { name: /Togli «Primo»/ }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Continua a guardare" })).not.toBeInTheDocument(),
    );
  });

  it("puts the video back in its place when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/", {
      ...signedIn(),
      "GET /api/continue": { body: started },
      "DELETE /api/continue/3": { status: 500, body: { error: "boom" } },
    });
    const row = await screen.findByRole("region", { name: "Continua a guardare" });
    await user.click(within(row).getByRole("button", { name: /Togli «Primo»/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Non sono riuscito a togliere");
    expect(titles(screen.getByRole("region", { name: "Continua a guardare" }))).toEqual([
      "Primo",
      "Secondo",
    ]);
  });
});
