import { screen } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";

describe("shared with me page", () => {
  it("lists the videos shared with me", async () => {
    const { server } = renderApp("/condivisi", {
      ...signedIn(),
      "GET /api/videos": {
        body: {
          videos: [
            videoJSON({ title: "Compleanno", private: true, uploader: { id: 5, name: "Giulia" } }),
          ],
          total: 1,
        },
      },
    });
    expect(await screen.findByRole("heading", { name: "Condivisi con te" })).toBeInTheDocument();
    expect(await screen.findByText("Compleanno")).toBeInTheDocument();
    const asked = new URL(server.requests.find((r) => r.url.includes("/api/videos"))?.url ?? "");
    expect(asked.searchParams.get("shared")).toBe("1");
  });

  it("says what will appear when nothing is shared yet", async () => {
    renderApp("/condivisi", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [], total: 0 } },
    });
    expect(await screen.findByText("Nessuno ti ha condiviso niente, per ora")).toBeInTheDocument();
  });
});
