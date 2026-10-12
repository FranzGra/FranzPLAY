import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

describe("online sources page", () => {
  it("turns YouTube on", async () => {
    const { user, server } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: { youtube: false } },
      "PUT /api/online": { body: { youtube: true } },
    });
    const list = await screen.findByRole("list", { name: "Fonti su internet" });
    const youtube = within(list).getByRole("checkbox", { name: "Accesa" });
    expect(youtube).not.toBeChecked();
    expect(list).toHaveTextContent("Non serve nessuna chiave");

    await user.click(youtube);
    expect(await screen.findByRole("status")).toHaveTextContent("un video alla volta");
    expect(youtube).toBeChecked();
    expect(await server.requests.at(-1)?.json()).toEqual({ youtube: true });
  });

  it("says when saving did not work", async () => {
    const { user } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: { youtube: true } },
      "PUT /api/online": { status: 500, body: { error: "boom" } },
    });
    await user.click(await screen.findByRole("checkbox", { name: "Accesa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Non si è riusciti a salvare");
    expect(screen.getByRole("checkbox", { name: "Accesa" })).toBeChecked();
  });
});
