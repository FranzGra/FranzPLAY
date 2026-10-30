import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";
import { tileColor } from "../categories/color";
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
  it("lists the categories once, and opens one at a time on the right", async () => {
    const { user } = renderApp("/admin/categorie", page());
    const list = await screen.findByRole("list", { name: "Categorie" });
    const [first, second] = within(list).getAllByRole("button");
    expect(first).toHaveTextContent("Lezioni");
    expect(first).toHaveTextContent("Cartella: Corsi");
    expect(first).toHaveAttribute("aria-current", "true");
    expect(second).toHaveTextContent("Viaggi");
    // One editor only: the colors are not repeated for every category.
    expect(screen.getAllByRole("button", { name: "Rosso" })).toHaveLength(1);

    const lezioni = screen.getByRole("form", { name: "Categoria Corsi" });
    expect(within(lezioni).getByRole("button", { name: "Rosso" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(lezioni).getByRole("button", { name: "Togli l'immagine" })).toBeInTheDocument();

    await user.click(second as HTMLElement);
    const plain = screen.getByRole("form", { name: "Categoria Viaggi" });
    expect(within(plain).getByRole("button", { name: "Nessun colore" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("form", { name: "Categoria Corsi" })).not.toBeInTheDocument();
  });

  it("previews a category without an image as the real card, in the public color", async () => {
    const { user } = renderApp("/admin/categorie", page());
    const list = await screen.findByRole("list", { name: "Categorie" });
    await user.click(within(list).getAllByRole("button")[1] as HTMLElement);
    const form = screen.getByRole("form", { name: "Categoria Viaggi" });
    const card = within(form).getByRole("img", { name: "Come la vedono tutti" });
    const tile = card.firstElementChild as HTMLElement;
    // The same color the public page gives this name, and the folder, not a placeholder.
    expect(tile.style.getPropertyValue("--tile-color")).toBe(
      tileColor({ name: "Viaggi", color: "" }),
    );
    expect(tile.querySelector("svg")).not.toBeNull();
    expect(tile).toHaveTextContent("Viaggi");
    expect(tile).toHaveTextContent("3 video");
    expect(card).not.toHaveTextContent("Nessuna immagine");

    // Typing a name or choosing a color changes the card at once.
    await user.type(within(form).getByRole("textbox"), "Gite");
    expect(tile).toHaveTextContent("Gite");
    await user.click(within(form).getByRole("button", { name: "Rosso" }));
    expect(tile.style.getPropertyValue("--tile-color")).toBe("#dc2626");
  });

  it("renames and colors a category, with a clear button to save", async () => {
    const { user, server } = renderApp(
      "/admin/categorie",
      page({ "PUT /api/admin/categories/Viaggi": { status: 204 } }),
    );
    await user.click(await screen.findByRole("button", { name: /Viaggi/ }));
    const form = screen.getByRole("form", { name: "Categoria Viaggi" });
    // Nothing changed: no grey button, a word that all is saved.
    expect(within(form).queryByRole("button", { name: "Salva nome e colore" })).toBeNull();
    expect(form).toHaveTextContent("Nessuna modifica da salvare");
    await user.type(
      within(form).getByRole("textbox", { name: /Nome che vedono tutti/ }),
      "Vacanze",
    );
    await user.click(within(form).getByRole("button", { name: "Viola" }));
    const save = within(form).getByRole("button", { name: "Salva nome e colore" });
    expect(save).toBeEnabled();
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
    const lezioni = await screen.findByRole("form", { name: "Categoria Corsi" });
    await user.click(within(lezioni).getByRole("button", { name: "Togli l'immagine" }));
    await waitFor(() => expect(server.requests.some((r) => r.method === "DELETE")).toBe(true));

    await user.click(screen.getByRole("button", { name: /Viaggi/ }));
    const form = screen.getByRole("form", { name: "Categoria Viaggi" });
    fireEvent.change(within(form).getByLabelText("Aggiungi un'immagine"), {
      target: { files: [new File(["x"], "mare.jpg", { type: "image/jpeg" })] },
    });
    const dialog = await screen.findByRole("dialog", { name: "Immagine di Viaggi" });
    await user.click(within(dialog).getByRole("button", { name: "Usa questa immagine" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(vi.mocked(renderCover)).toHaveBeenCalled();
    const sent = server.requests.find((r) => r.url.endsWith("/Viaggi/image"));
    expect(sent?.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("says how a category is born when there is none", async () => {
    renderApp("/admin/categorie", page({ "GET /api/admin/categories": { body: [] } }));
    expect(
      await screen.findByRole("heading", { name: "Ancora nessuna categoria" }),
    ).toBeInTheDocument();
  });

  it("is in the administration's sections", async () => {
    renderApp("/admin/categorie", page());
    expect(
      await screen.findByRole("link", { name: "Categorie", current: "page" }),
    ).toBeInTheDocument();
  });
});
