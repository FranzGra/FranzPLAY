import { screen } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

const allOff = { youtube: false, tmdb: false, tmdbKey: false };

describe("online sources page", () => {
  it("turns YouTube on", async () => {
    const { user, server } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: allOff },
      "PUT /api/online": { body: { ...allOff, youtube: true } },
    });
    const list = await screen.findByRole("list", { name: "Fonti su internet" });
    const youtube = screen.getByRole("checkbox", { name: "YouTube accesa" });
    expect(youtube).not.toBeChecked();
    expect(list).toHaveTextContent("Non serve nessuna chiave");

    await user.click(youtube);
    expect(await screen.findByRole("status")).toHaveTextContent("un video alla volta");
    expect(youtube).toBeChecked();
    expect(await server.requests.at(-1)?.json()).toEqual({ youtube: true, tmdb: false });
  });

  it("says when saving did not work", async () => {
    const { user } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: { ...allOff, youtube: true } },
      "PUT /api/online": { status: 500, body: { error: "boom" } },
    });
    await user.click(await screen.findByRole("checkbox", { name: "YouTube accesa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Non si è riusciti a salvare");
    expect(screen.getByRole("checkbox", { name: "YouTube accesa" })).toBeChecked();
  });

  it("saves TMDB's key, then turns TMDB on", async () => {
    const key = "0123456789abcdef0123456789abcdef";
    const { user, server } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: allOff },
      "PUT /api/online/tmdb-key": { body: { ...allOff, tmdbKey: true } },
      "PUT /api/online": { body: { ...allOff, tmdb: true, tmdbKey: true } },
    });
    const tmdb = await screen.findByRole("checkbox", { name: "TMDB accesa" });
    expect(tmdb).toBeDisabled();
    expect(screen.getByText(/non è approvato né certificato da TMDB/)).toBeInTheDocument();
    expect(screen.getByText(/Nessuna chiave salvata/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Chiave di TMDB"), ` ${key} `);
    await user.click(screen.getByRole("button", { name: "Prova e salva" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Ora puoi accendere TMDB");
    expect(await server.requests.at(-1)?.json()).toEqual({ key });
    expect(screen.getByText(/La chiave è salvata/)).toBeInTheDocument();
    expect(screen.getByLabelText("Nuova chiave di TMDB")).toHaveValue("");

    await user.click(tmdb);
    expect(await screen.findByRole("status")).toHaveTextContent("un video alla volta");
    expect(tmdb).toBeChecked();
    expect(await server.requests.at(-1)?.json()).toEqual({ youtube: false, tmdb: true });
  });

  it("says when TMDB refuses the key", async () => {
    const { user } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: allOff },
      "PUT /api/online/tmdb-key": { status: 422, body: { error: "TMDB refused the key" } },
    });
    await user.type(
      await screen.findByLabelText("Chiave di TMDB"),
      "0123456789abcdef0123456789abcdef",
    );
    await user.click(screen.getByRole("button", { name: "Prova e salva" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("non è valida");
    expect(screen.getByRole("checkbox", { name: "TMDB accesa" })).toBeDisabled();
  });
});
