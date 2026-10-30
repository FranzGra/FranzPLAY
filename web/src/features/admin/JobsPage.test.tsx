import { act, screen, within } from "@testing-library/react";
import { parseJobsOverview } from "../../api/jobs";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { renderApp, signedIn } from "../../test/render";

function failedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    kind: "cover",
    videoId: 7,
    title: "Mare 2024",
    attempts: 3,
    error: "ffmpeg: invalid data found",
    at: "2026-10-12T10:00:00Z",
    ...overrides,
  };
}

function overview(overrides: Record<string, unknown> = {}) {
  return {
    waiting: 4,
    retrying: 1,
    done: 12345,
    running: null,
    failed: [failedJob()],
    failedTotal: 1,
    kinds: [
      { kind: "probe", available: true },
      { kind: "cover", available: true },
      { kind: "preview", available: true },
      { kind: "tracks", available: true },
      { kind: "convert", available: true },
    ],
    ...overrides,
  };
}

describe("parseJobsOverview", () => {
  it("refuses an unknown kind of job", () => {
    expect(() =>
      parseJobsOverview(overview({ failed: [failedJob({ kind: "transcode" })] })),
    ).toThrow();
  });
});

describe("jobs page", () => {
  it("shows what runs now, the queue and what did not work", async () => {
    renderApp("/admin/lavori", {
      ...signedIn(),
      "GET /api/jobs": {
        body: overview({
          running: failedJob({ id: 12, kind: "preview", title: "Neve", error: "", attempts: 0 }),
        }),
      },
    });
    const now = await screen.findByRole("region", { name: "Al lavoro ora" });
    expect(within(now).getByRole("link", { name: "Neve" })).toHaveAttribute(
      "href",
      "/admin/video/7",
    );
    expect(within(now).getByText("Anteprime sulla barra")).toBeInTheDocument();
    // An older server does not say how far the job is: the bar only moves.
    expect(
      within(now).getByRole("progressbar", { name: "Anteprime sulla barra di Neve" }),
    ).not.toHaveAttribute("aria-valuenow");

    expect(screen.getByText("12.345")).toBeInTheDocument();
    expect(screen.getByText("1 sta per essere riprovato")).toBeInTheDocument();

    const failed = screen.getByRole("list", { name: "Lavori non riusciti" });
    expect(within(failed).getByRole("link", { name: "Mare 2024" })).toHaveAttribute(
      "href",
      "/admin/video/7",
    );
    expect(within(failed).getByText("ffmpeg: invalid data found")).toBeInTheDocument();
    expect(within(failed).getByText(/^Copertina · 3 tentativi/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says when ffmpeg is missing", async () => {
    renderApp("/admin/lavori", {
      ...signedIn(),
      "GET /api/jobs": {
        body: overview({
          kinds: [
            { kind: "probe", available: true },
            { kind: "cover", available: false },
            { kind: "preview", available: false },
            { kind: "tracks", available: false },
            { kind: "convert", available: false },
          ],
        }),
      },
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Manca ffmpeg");
    expect(alert).toHaveTextContent("non lo trova su questo computer");
  });

  it("retries a failed job and shows the queue again", async () => {
    let failed = [failedJob()];
    const { user, server } = renderApp("/admin/lavori", {
      ...signedIn(),
      "GET /api/jobs": () =>
        new Response(JSON.stringify(overview({ failed, failedTotal: failed.length }))),
      "POST /api/jobs/11/retry": () => {
        failed = [];
        return new Response(null, { status: 204 });
      },
    });
    const list = await screen.findByRole("list", { name: "Lavori non riusciti" });
    await user.click(within(list).getByRole("button", { name: "Riprova Copertina di Mare 2024" }));
    expect(
      await screen.findByRole("heading", { name: "Nessun lavoro non riuscito" }),
    ).toBeInTheDocument();
    expect(server.requests.some((r) => r.method === "POST")).toBe(true);
  });

  it("retries every failed job at once", async () => {
    const { user, server } = renderApp("/admin/lavori", {
      ...signedIn(),
      "GET /api/jobs": {
        body: overview({
          failed: [failedJob(), failedJob({ id: 12, title: "Neve" })],
          failedTotal: 2,
        }),
      },
      "POST /api/jobs/retry": { body: { count: 2 } },
    });
    await user.click(await screen.findByRole("button", { name: "Riprova tutti" }));
    await vi.waitFor(() =>
      expect(server.requests.some((r) => new URL(r.url).pathname === "/api/jobs/retry")).toBe(true),
    );
  });

  it("follows the queue as it moves", async () => {
    stubEventSource();
    let waiting = 4;
    renderApp("/admin/lavori", {
      ...signedIn(),
      "GET /api/jobs": () => new Response(JSON.stringify(overview({ waiting }))),
    });
    const queue = await screen.findByRole("region", { name: "In coda" });
    expect(await within(queue).findByText("4")).toBeInTheDocument();
    waiting = 3;
    act(() => FakeEventSource.last?.emit("jobs"));
    expect(await within(queue).findByText("3")).toBeInTheDocument();
  });

  it("asks one question at a time, however fast the queue moves", async () => {
    stubEventSource();
    const answers: (() => void)[] = [];
    let asked = 0;
    let aborted = 0;
    renderApp("/admin/lavori", {
      ...signedIn(),
      "GET /api/jobs": (request: Request) => {
        asked++;
        request.signal.addEventListener("abort", () => aborted++);
        return new Promise<Response>((resolve) => {
          answers.push(() => resolve(new Response(JSON.stringify(overview({ waiting: asked })))));
        });
      },
    });
    await vi.waitFor(() => expect(asked).toBe(1));
    // The server is slow, and three changes come while it thinks.
    act(() => {
      FakeEventSource.last?.emit("jobs");
      FakeEventSource.last?.emit("jobs");
      FakeEventSource.last?.emit("jobs");
    });
    expect(asked).toBe(1);
    expect(aborted).toBe(0);
    // When the answer comes, one more question covers all three.
    await act(async () => answers[0]?.());
    await vi.waitFor(() => expect(asked).toBe(2));
    await act(async () => answers[1]?.());
    await screen.findByRole("region", { name: "In coda" });
    expect(asked).toBe(2);
    expect(aborted).toBe(0);
  });

  it("is in the administration sections", async () => {
    renderApp("/admin/lavori", { ...signedIn(), "GET /api/jobs": { body: overview() } });
    const sections = await screen.findByRole("navigation", {
      name: "Sezioni dell'amministrazione",
    });
    expect(within(sections).getByRole("link", { name: "Lavori" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows how far the work is, the queue in order and what ended", async () => {
    const view = (o: Record<string, unknown>) => ({
      ...failedJob({ error: "", attempts: 1 }),
      state: "pending",
      cover: null,
      duration: 1960,
      urgent: false,
      runAfter: null,
      startedAt: null,
      endedAt: null,
      seconds: null,
      stage: "",
      progress: null,
      doneSeconds: null,
      totalSeconds: null,
      ...o,
    });
    const transcribing = view({
      id: 20,
      kind: "transcribe",
      title: "Neve",
      state: "running",
      startedAt: "2026-10-29T10:00:00Z",
      seconds: 120,
      stage: "transcribe",
      progress: 40,
      doneSeconds: 725,
      totalSeconds: 1960,
    });
    const model = view({
      id: 0,
      videoId: 0,
      kind: "model",
      title: "base",
      state: "running",
      seconds: 10,
      doneSeconds: 50 << 20,
      totalSeconds: 100 << 20,
    });
    const count = (kind: string, o: Record<string, number> = {}) => ({
      kind,
      waiting: 0,
      retrying: 0,
      running: 0,
      done: 0,
      failed: 0,
      recent: 0,
      ...o,
    });
    renderApp("/admin/lavori", {
      ...signedIn(),
      "GET /api/jobs": {
        body: overview({
          waiting: 2,
          retrying: 0,
          running: transcribing,
          failed: [],
          failedTotal: 0,
          active: [transcribing, model],
          queue: [
            view({ id: 31, kind: "cover", title: "Lago", urgent: true }),
            view({ id: 32, kind: "preview", title: "Bosco" }),
          ],
          recent: [
            view({ id: 41, kind: "probe", title: "Mare", state: "done", seconds: 12 }),
            view({
              id: 42,
              kind: "convert",
              title: "Gita",
              state: "failed",
              seconds: 75,
              error: "ffmpeg: no space left",
            }),
          ],
          recentTotal: 2,
          counts: [
            count("probe", { recent: 1 }),
            count("cover", { waiting: 1 }),
            count("preview", { waiting: 1 }),
            count("transcribe", { running: 1 }),
            count("convert", { recent: 1 }),
          ],
        }),
      },
    });
    const now = await screen.findByRole("region", { name: "Al lavoro ora" });
    expect(
      within(now).getByRole("progressbar", { name: "Trascrizione con Whisper di Neve" }),
    ).toHaveAttribute("aria-valuenow", "40");
    expect(now).toHaveTextContent("40% · restano circa 3 min");
    expect(now).toHaveTextContent("12:05 di 32:40 ascoltati");
    expect(within(now).getByText("Whisper ascolta")).toBeInTheDocument();
    // The model download comes with the queue, bytes and speed included.
    const download = screen.getByRole("region", { name: "Download" });
    expect(download).toHaveTextContent(
      "50 MB di 100 MB · 50% · 5 MB/s · restano meno di un minuto",
    );

    const queue = screen.getByRole("list", { name: "Lavori in coda" });
    const rows = within(queue).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Lago"),
      expect.stringContaining("Bosco"),
    ]);
    expect(rows[0]).toHaveTextContent("Prima");
    // No way to take a job out of the queue yet: no button for it.
    expect(within(queue).queryByRole("button")).not.toBeInTheDocument();

    const recent = screen.getByRole("list", { name: "Lavori finiti di recente" });
    expect(recent).toHaveTextContent("Lettura del video · in 12 s");
    expect(recent).toHaveTextContent("Copia per i browser · in 1:15");
    expect(recent).toHaveTextContent("ffmpeg: no space left");
    expect(within(recent).getByText("Non riuscito")).toBeInTheDocument();
  });

  it("shows one kind of work only", async () => {
    const { user } = renderApp("/admin/lavori", {
      ...signedIn(),
      "GET /api/jobs": {
        body: overview({
          active: [],
          queue: [
            { ...failedJob({ id: 31, kind: "cover", title: "Lago", error: "" }), state: "pending" },
            {
              ...failedJob({ id: 32, kind: "preview", title: "Bosco", error: "" }),
              state: "pending",
            },
          ],
          recent: [],
          recentTotal: 0,
          counts: [
            { kind: "cover", waiting: 1, retrying: 0, running: 0, done: 0, failed: 1, recent: 0 },
            { kind: "preview", waiting: 1, retrying: 0, running: 0, done: 0, failed: 0, recent: 0 },
          ],
        }),
      },
    });
    const queue = await screen.findByRole("list", { name: "Lavori in coda" });
    expect(within(queue).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Anteprime 1" }));
    expect(within(queue).getAllByRole("listitem")).toHaveLength(1);
    expect(queue).toHaveTextContent("Bosco");
    // The failed cover is not of this kind.
    expect(screen.getByRole("heading", { name: "Nessun lavoro non riuscito" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tutti" }));
    expect(within(queue).getAllByRole("listitem")).toHaveLength(2);
  });
});
