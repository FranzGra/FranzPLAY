import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

const allOff = {
  youtube: false,
  tmdb: false,
  tpdb: false,
  tmdbKey: false,
  tpdbKey: false,
  rules: { from: 0, to: 0, daily: 0, order: ["youtube", "tmdb", "tpdb"], confirm: false },
  askedToday: 0,
  proposals: 0,
};

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
    expect(await server.requests.at(-1)?.json()).toEqual({
      youtube: true,
      tmdb: false,
      tpdb: false,
    });
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
    const card = tmdb.closest("li") as HTMLElement;
    expect(card).toHaveTextContent("Nessuna chiave salvata");

    const form = screen.getByRole("form", { name: "Salva la chiave di TMDB" });
    await user.type(within(form).getByLabelText("Chiave di TMDB"), ` ${key} `);
    await user.click(within(form).getByRole("button", { name: "Prova e salva" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Ora puoi accendere TMDB");
    expect(await server.requests.at(-1)?.json()).toEqual({ key });
    expect(card).toHaveTextContent("La chiave è salvata");
    expect(screen.getByLabelText("Nuova chiave di TMDB")).toHaveValue("");

    await user.click(tmdb);
    expect(await screen.findByRole("status")).toHaveTextContent("un video alla volta");
    expect(tmdb).toBeChecked();
    expect(await server.requests.at(-1)?.json()).toEqual({
      youtube: false,
      tmdb: true,
      tpdb: false,
    });
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
    await user.click(
      within(screen.getByRole("form", { name: "Salva la chiave di TMDB" })).getByRole("button", {
        name: "Prova e salva",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TMDB dice che questa chiave non è valida",
    );
    expect(screen.getByRole("checkbox", { name: "TMDB accesa" })).toBeDisabled();
  });

  it("saves ThePornDB's key, then turns it on", async () => {
    const key = "123|AbCdEfGhIjKlMnOpQrStUv";
    const { user, server } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: allOff },
      "PUT /api/online/tpdb-key": { body: { ...allOff, tpdbKey: true } },
      "PUT /api/online": { body: { ...allOff, tpdb: true, tpdbKey: true } },
    });
    const tpdb = await screen.findByRole("checkbox", { name: "ThePornDB accesa" });
    expect(tpdb).toBeDisabled();
    expect(tpdb.closest("li")).toHaveTextContent("calcola un'impronta del file");

    const form = screen.getByRole("form", { name: "Salva la chiave di ThePornDB" });
    await user.type(within(form).getByLabelText("Chiave di ThePornDB"), key);
    await user.click(within(form).getByRole("button", { name: "Prova e salva" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Ora puoi accendere ThePornDB");
    expect(server.requests.at(-1)?.url).toContain("/api/online/tpdb-key");
    expect(await server.requests.at(-1)?.json()).toEqual({ key });

    await user.click(tpdb);
    expect(await screen.findByRole("status")).toHaveTextContent("un video alla volta");
    expect(await server.requests.at(-1)?.json()).toEqual({
      youtube: false,
      tmdb: false,
      tpdb: true,
    });
  });

  it("saves the hours, the daily limit and the order of the sources", async () => {
    const saved = {
      ...allOff,
      rules: { from: 22, to: 6, daily: 50, order: ["tmdb", "youtube", "tpdb"], confirm: false },
    };
    const { user, server } = renderApp("/admin/internet", {
      ...signedIn(),
      "GET /api/online": { body: { ...allOff, askedToday: 3 } },
      "PUT /api/online/rules": { body: saved },
    });
    const form = await screen.findByRole("form", { name: "Regole" });
    expect(form).toHaveTextContent("ha chiesto informazioni su 3 video");
    expect(within(form).queryByRole("combobox", { name: "Dalle" })).not.toBeInTheDocument();

    await user.click(within(form).getByRole("checkbox", { name: "Chiedi solo in certe ore" }));
    await user.selectOptions(within(form).getByRole("combobox", { name: "Dalle" }), "22:00");
    await user.selectOptions(within(form).getByRole("combobox", { name: "Alle" }), "06:00");
    const daily = within(form).getByRole("spinbutton", { name: /quanti video al giorno/ });
    await user.clear(daily);
    await user.type(daily, "50");
    expect(within(form).getByRole("button", { name: "Sposta YouTube su" })).toBeDisabled();
    await user.click(within(form).getByRole("button", { name: "Sposta TMDB (film) su" }));
    const order = within(form).getByRole("list", { name: "Ordine delle fonti" });
    expect(within(order).getAllByRole("listitem")[0]).toHaveTextContent("1. TMDB (film)");

    await user.click(within(form).getByRole("button", { name: "Salva le regole" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Regole salvate");
    expect(await server.requests.at(-1)?.json()).toEqual(saved.rules);
  });
});
