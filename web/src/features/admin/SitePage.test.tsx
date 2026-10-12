import { screen } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

describe("site settings page", () => {
  it("opens registration to anyone, then closes it", async () => {
    let open = false;
    const { user, server } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "PUT /api/registration": () => {
        open = !open;
        return new Response(JSON.stringify({ open }));
      },
    });
    const box = await screen.findByRole("checkbox", { name: "Chiunque può registrarsi" });
    expect(box).not.toBeChecked();

    await user.click(box);
    expect(await screen.findByRole("status")).toHaveTextContent("Registrazione aperta");
    expect(box).toBeChecked();
    expect(await server.requests.at(-1)?.json()).toEqual({ open: true });

    await user.click(box);
    expect(await screen.findByRole("status")).toHaveTextContent("Registrazione chiusa");
    expect(box).not.toBeChecked();
  });

  it("says when saving did not work", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderApp("/admin/sito", {
      ...signedIn(),
      "GET /api/registration": { body: { open: false } },
      "PUT /api/registration": { status: 500, body: { error: "boom" } },
    });
    await user.click(await screen.findByRole("checkbox", { name: "Chiunque può registrarsi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Non si è riusciti a salvare");
    expect(screen.getByRole("checkbox", { name: "Chiunque può registrarsi" })).not.toBeChecked();
  });
});
