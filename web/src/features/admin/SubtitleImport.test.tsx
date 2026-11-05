import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeServer, type Routes } from "../../test/render";
import { SubtitleImport } from "./SubtitleImport";

const path = "/api/admin/subtitles/7/import";

function srt(name = "mare.srt", text = "1\n00:00:01,000 --> 00:00:02,000\nCiao\n") {
  return new File([text], name, { type: "application/x-subrip" });
}

function show(routes: Routes, props: { lang?: string; onCancel?: () => void } = {}) {
  const user = userEvent.setup({ delay: null, applyAccept: false });
  const server = fakeServer(routes);
  const onDone = vi.fn();
  const { unmount } = render(
    <SubtitleImport videoId={7} title="Mare 2024" onDone={onDone} {...props} />,
  );
  const form = screen.getByRole("form", { name: "Importa sottotitoli per Mare 2024" });
  const input = within(form).getByLabelText("Scegli il file");
  return { user, server, onDone, form, input, unmount };
}

// A route that answers only when the test says so.
function later() {
  let answer: (r: Response) => void = () => {};
  const route = () =>
    new Promise<Response>((resolve) => {
      answer = resolve;
    });
  return { route, answer: (r: Response) => answer(r) };
}

const refusal = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("subtitle import", () => {
  it("imports a file in the chosen language", async () => {
    const pending = later();
    const { user, server, onDone, form, input } = show({ [`PUT ${path}/en`]: pending.route });
    await user.click(within(form).getByRole("combobox", { name: "Lingua dei sottotitoli" }));
    await user.click(screen.getByRole("option", { name: "Inglese" }));
    await user.upload(input, srt());
    expect(form).toHaveTextContent("mare.srt");
    expect(within(form).getByText("Scegli un altro file")).toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: "Importa" }));
    // While it is sent nothing can be changed.
    expect(within(form).getByRole("button", { name: "Importo…" })).toBeDisabled();
    expect(within(form).getByRole("combobox", { name: "Lingua dei sottotitoli" })).toBeDisabled();
    expect(input).toBeDisabled();

    await act(async () => pending.answer(new Response(null, { status: 204 })));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("en"));
    const sent = server.requests[0];
    expect(sent?.method).toBe("PUT");
    expect(new URL(sent?.url ?? "").search).toBe("");
    expect(sent?.headers.get("Content-Type")).toBe("application/x-subrip");
    expect(await sent?.text()).toContain("Ciao");
    // Ready for another file.
    expect(await within(form).findByText("Scegli il file")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Importa" })).toBeEnabled();
  });

  it("starts from the language asked, or Italian for one it does not know", async () => {
    const first = show({}, { lang: "fr" });
    expect(
      within(first.form).getByRole("combobox", { name: "Lingua dei sottotitoli" }),
    ).toHaveTextContent("Francese");
    first.unmount();

    const second = show({}, { lang: "xx" });
    expect(
      within(second.form).getByRole("combobox", { name: "Lingua dei sottotitoli" }),
    ).toHaveTextContent("Italiano");
  });

  it("asks for a file before sending", async () => {
    const { user, server, onDone, form } = show({});
    await user.click(within(form).getByRole("button", { name: "Importa" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Scegli prima un file .srt o .vtt.");
    expect(server.requests).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each([
    ["not subtitles", new File(["x"], "mare.txt"), "solo file di sottotitoli .srt o .vtt"],
    ["a video", new File(["x"], "mare.mp4", { type: "video/mp4" }), ".srt o .vtt"],
    ["empty", new File([], "vuoto.srt"), "Il file è vuoto."],
    [
      "over 2 MB",
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], "lungo.vtt"),
      "troppo grande: al massimo 2 MB",
    ],
  ])("refuses a file that is %s, without sending it", async (_label, file, words) => {
    const { user, server, form, input } = show({});
    await user.upload(input, file);
    expect(within(form).getByRole("alert")).toHaveTextContent(words);
    expect(within(form).getByText("Scegli il file")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Importa" }));
    expect(server.requests).toHaveLength(0);
  });

  it("accepts the extension in capitals, and a name with accents and spaces", async () => {
    const { user, server, onDone, form, input } = show({
      [`PUT ${path}/it`]: { status: 204 },
    });
    await user.upload(input, srt("Perché sì – parte 1.SRT"));
    expect(within(form).queryByRole("alert")).toBeNull();
    expect(form).toHaveTextContent("Perché sì – parte 1.SRT");
    await user.click(within(form).getByRole("button", { name: "Importa" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("it"));
    expect(server.requests).toHaveLength(1);
  });

  it("clears an earlier problem when a good file is chosen", async () => {
    const { user, form, input } = show({});
    await user.upload(input, new File(["x"], "mare.txt"));
    expect(within(form).getByRole("alert")).toBeInTheDocument();
    await user.upload(input, srt());
    expect(within(form).queryByRole("alert")).toBeNull();
    expect(form).toHaveTextContent("mare.srt");
  });

  it("asks before replacing subtitles already there, then replaces them", async () => {
    const { user, server, onDone, form, input } = show({
      [`PUT ${path}/it`]: (request) =>
        new URL(request.url).search === "?replace=1"
          ? new Response(null, { status: 204 })
          : refusal(409, "subtitles already there"),
    });
    await user.upload(input, srt());
    await user.click(within(form).getByRole("button", { name: "Importa" }));

    const ask = await within(form).findByRole("alertdialog", { name: "Sostituire i sottotitoli?" });
    expect(ask).toHaveTextContent("Ci sono già sottotitoli in italiano per questo video.");
    // A refusal that only asks is not shown as an error.
    expect(within(form).queryByRole("alert")).toBeNull();
    expect(within(form).queryByRole("button", { name: "Importa" })).toBeNull();
    expect(onDone).not.toHaveBeenCalled();

    await user.click(within(ask).getByRole("button", { name: "Sostituisci" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("it"));
    expect(server.requests.map((r) => new URL(r.url).search)).toEqual(["", "?replace=1"]);
    expect(within(form).queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the subtitles there when asked not to replace them", async () => {
    const { user, server, onDone, form, input } = show({
      [`PUT ${path}/it`]: () => refusal(409, "subtitles already there"),
    });
    await user.upload(input, srt());
    await user.click(within(form).getByRole("button", { name: "Importa" }));
    const ask = await within(form).findByRole("alertdialog");
    await user.click(within(ask).getByRole("button", { name: "Non sostituire" }));
    expect(within(form).queryByRole("alertdialog")).toBeNull();
    // The file stays chosen, to try another language.
    expect(form).toHaveTextContent("mare.srt");
    expect(within(form).getByRole("button", { name: "Importa" })).toBeEnabled();
    expect(server.requests).toHaveLength(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("forgets the question when the language changes", async () => {
    const { user, form, input } = show({
      [`PUT ${path}/it`]: () => refusal(409, "subtitles already there"),
    });
    await user.upload(input, srt());
    await user.click(within(form).getByRole("button", { name: "Importa" }));
    await within(form).findByRole("alertdialog");
    await user.click(within(form).getByRole("combobox", { name: "Lingua dei sottotitoli" }));
    await user.click(screen.getByRole("option", { name: "Tedesco" }));
    expect(within(form).queryByRole("alertdialog")).toBeNull();
    expect(within(form).getByRole("button", { name: "Importa" })).toBeInTheDocument();
  });

  it("names the language of the subtitles already there", async () => {
    const { user, form, input } = show(
      { [`PUT ${path}/es`]: () => refusal(409, "subtitles already there") },
      { lang: "es" },
    );
    await user.upload(input, srt());
    await user.click(within(form).getByRole("button", { name: "Importa" }));
    expect(await within(form).findByRole("alertdialog")).toHaveTextContent(
      "sottotitoli in spagnolo",
    );
  });

  it.each([
    [400, "the file has no cues"],
    [413, "the file is too big"],
    [415, "this is not a subtitle file"],
  ])("shows the server's reason for %i", async (status, reason) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user, onDone, form, input } = show({
      [`PUT ${path}/it`]: () => refusal(status, reason),
    });
    await user.upload(input, srt());
    await user.click(within(form).getByRole("button", { name: "Importa" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(reason);
    expect(within(form).getByRole("button", { name: "Importa" })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each([
    ["the server fails", () => refusal(500, "internal error")],
    ["the login is not an administrator's", () => refusal(403, "admin only")],
    [
      "the network is down",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("says to try again when %s", async (_label, route) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { user, onDone, form, input } = show({ [`PUT ${path}/it`]: route });
    await user.upload(input, srt());
    await user.click(within(form).getByRole("button", { name: "Importa" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Non sono riuscito a importare il file. Riprova tra poco.",
    );
    expect(error).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    // The file stays, to try again.
    expect(form).toHaveTextContent("mare.srt");
  });

  it("offers to leave it only where it can be left", async () => {
    const onCancel = vi.fn();
    const withCancel = show({}, { onCancel });
    await withCancel.user.click(
      within(withCancel.form).getByRole("button", { name: "Lascia stare" }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(withCancel.server.requests).toHaveLength(0);
    withCancel.unmount();

    const without = show({});
    expect(within(without.form).queryByRole("button", { name: "Lascia stare" })).toBeNull();
  });
});
