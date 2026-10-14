import { act, screen, within } from "@testing-library/react";
import { parseJobsOverview } from "../../api/jobs";
import { FakeEventSource, stubEventSource } from "../../test/eventSource";
import { renderApp, signedIn } from "../../test/render";
function failedJob(overrides = {}) {
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
function overview(overrides = {}) {
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
        expect(() => parseJobsOverview(overview({ failed: [failedJob({ kind: "transcode" })] }))).toThrow();
    });
});
describe("jobs page", () => {
    it("shows the queue", async () => {
        renderApp("/admin/lavori", {
            ...signedIn(),
            "GET /api/jobs": {
                body: overview({
                    running: failedJob({ id: 12, kind: "preview", title: "Neve", error: "", attempts: 0 }),
                }),
            },
        });
        expect(await screen.findByText("12.345")).toBeInTheDocument();
        expect(screen.getByText(/Anteprime sulla barra di/)).toHaveTextContent("Anteprime sulla barra di Neve");
        expect(screen.getByText("(1 da riprovare)")).toBeInTheDocument();
        const failed = screen.getByRole("list", { name: "Lavori falliti" });
        expect(within(failed).getByRole("link", { name: "Mare 2024" })).toHaveAttribute("href", "/video/7");
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
        expect(await screen.findByRole("alert")).toHaveTextContent("non trova ffmpeg su questo computer");
    });
    it("retries a failed job and shows the queue again", async () => {
        let failed = [failedJob()];
        const { user, server } = renderApp("/admin/lavori", {
            ...signedIn(),
            "GET /api/jobs": () => new Response(JSON.stringify(overview({ failed, failedTotal: failed.length }))),
            "POST /api/jobs/11/retry": () => {
                failed = [];
                return new Response(null, { status: 204 });
            },
        });
        const list = await screen.findByRole("list", { name: "Lavori falliti" });
        await user.click(within(list).getByRole("button", { name: "Riprova" }));
        expect(await screen.findByText("Nessun lavoro fallito. Tutto bene.")).toBeInTheDocument();
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
        await vi.waitFor(() => expect(server.requests.some((r) => new URL(r.url).pathname === "/api/jobs/retry")).toBe(true));
    });
    it("follows the queue as it moves", async () => {
        stubEventSource();
        let waiting = 4;
        renderApp("/admin/lavori", {
            ...signedIn(),
            "GET /api/jobs": () => new Response(JSON.stringify(overview({ waiting }))),
        });
        expect(await screen.findByText("4")).toBeInTheDocument();
        waiting = 3;
        act(() => FakeEventSource.last?.emit("jobs"));
        expect(await screen.findByText("3")).toBeInTheDocument();
    });
    it("is in the administration sections", async () => {
        renderApp("/admin/lavori", { ...signedIn(), "GET /api/jobs": { body: overview() } });
        const sections = await screen.findByRole("navigation", {
            name: "Sezioni dell'amministrazione",
        });
        expect(within(sections).getByRole("link", { name: "Lavori" })).toHaveAttribute("aria-current", "page");
    });
});
