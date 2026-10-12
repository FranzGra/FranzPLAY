import { screen, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

describe("categories", () => {
  it("lists the categories with their videos", async () => {
    renderApp("/categorie", {
      ...signedIn(),
      "GET /api/categories": {
        body: [
          { name: "Gite & mare", videos: 3 },
          { name: "Scuola", videos: 1 },
        ],
      },
    });
    const link = await screen.findByRole("link", { name: /Gite & mare/ });
    expect(link).toHaveAttribute("href", "/categorie/Gite%20%26%20mare");
    expect(within(link).getByText("3 video")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Scuola/ })).toBeInTheDocument();
  });

  it("explains where categories come from when there are none", async () => {
    renderApp("/categorie");
    expect(
      await screen.findByRole("heading", { name: "Ancora nessuna categoria" }),
    ).toBeInTheDocument();
  });

  it("shows the videos of one category", async () => {
    const { server } = renderApp("/categorie/Gite%20%26%20mare", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [videoJSON({ category: "Gite & mare" })], total: 1 } },
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Gite & mare" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Video di Gite & mare" })).toBeInTheDocument();
    const url = new URL(server.requests.find((r) => r.url.includes("/api/videos"))?.url ?? "");
    expect(url.searchParams.get("category")).toBe("Gite & mare");
  });
});
