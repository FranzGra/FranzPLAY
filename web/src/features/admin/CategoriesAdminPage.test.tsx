import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";
import { renderCover } from "./coverImage";

// jsdom has no real images or canvas: the two browser-only steps are faked.
vi.mock("../profile/photo", () => ({
  loadPhoto: vi.fn(async () => ({ url: "blob:picture", width: 1600, height: 900 })),
}));
vi.mock("./coverImage", () => ({
  renderCover: vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" })),
}));

const viaggi = { name: "Viaggi", label: "", color: "", image: null, videos: 3 };
const corsi = {
  name: "Corsi",
  label: "Lezioni",
  color: "#dc2626",
  image: "/api/category-images/2-0123456789abcdef.jpg",
  videos: 1,
};

function page(extra: Record<string, unknown> = {}) {
  return {
    ...signedIn(),
    "GET /api/admin/categories": { body: [corsi, viaggi] },
    ...extra,
  };
}

describe("categories in the administration", () => {
  it("lists each category with what people see", async () => {
    renderApp("/admin/categorie", page());
    const lezioni = await screen.findByRole("form", { name: "Categoria Corsi" });
    expect(lezioni).toHaveTextContent("Lezioni");
    expect(lezioni).toHaveTextContent("Cartella: Corsi");
    expect(within(lezioni).getByRole("button", { name: "Rosso" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(lezioni).getByRole("button", { name: "Togli l'immagine" })).toBeInTheDocument();
    const plain = screen.getByRole("form", { name: "Categoria Viaggi" });
    expect(within(plain).getByRole("button", { name: "Nessun colore" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renames and colors a category", async () => {
    const { user, server } = renderApp(
      "/admin/categorie",
      page({ "PUT /api/admin/categories/Viaggi": { status: 204 } }),
    );
    const form = await screen.findByRole("form", { name: "Categoria Viaggi" });
    const save = within(form).getByRole("button", { name: "Salva nome e colore" });
    expect(save).toBeDisabled();
    await user.type(
      within(form).getByRole("textbox", { name: "Nome che vedono tutti" }),
      "Vacanze",
    );
    await user.click(within(form).getByRole("button", { name: "Viola" }));
    await user.click(save);
    expect(await within(form).findByRole("status")).toHaveTextContent("Salvato.");
    const sent = server.requests.find((r) => r.method === "PUT");
    expect(await sent?.json()).toEqual({ label: "Vacanze", color: "#7c3aed" });
  });

  it("gives a category an image, and takes it away", async () => {
    const { user, server } = renderApp(
      "/admin/categorie",
      page({
        "PUT /api/admin/categories/Viaggi/image": { status: 204 },
        "DELETE /api/admin/categories/Corsi/image": { status: 204 },
      }),
    );
    const form = await screen.findByRole("form", { name: "Categoria Viaggi" });
    fireEvent.change(within(form).getByLabelText("Aggiungi un'immagine"), {
      target: { files: [new File(["x"], "mare.jpg", { type: "image/jpeg" })] },
    });
    const dialog = await screen.findByRole("dialog", { name: "Immagine di Viaggi" });
    await user.click(within(dialog).getByRole("button", { name: "Usa questa immagine" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(vi.mocked(renderCover)).toHaveBeenCalled();
    const sent = server.requests.find((r) => r.url.endsWith("/Viaggi/image"));
    expect(sent?.headers.get("Content-Type")).toBe("image/jpeg");

    const lezioni = screen.getByRole("form", { name: "Categoria Corsi" });
    await user.click(within(lezioni).getByRole("button", { name: "Togli l'immagine" }));
    await waitFor(() => expect(server.requests.some((r) => r.method === "DELETE")).toBe(true));
  });

  it("is in the administration's sections", async () => {
    renderApp("/admin/categorie", page());
    expect(
      await screen.findByRole("link", { name: "Categorie", current: "page" }),
    ).toBeInTheDocument();
  });
});
