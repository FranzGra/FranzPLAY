import { jsx as _jsx } from "react/jsx-runtime";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../app/App";
export const testAccount = {
    id: 1,
    name: "Paolo",
    role: "admin",
    canUpload: true,
    uploadQuota: 10737418240,
    accentColor: "",
    avatar: 0,
};
// fakeServer replaces fetch() with a small pretend server. Unknown
// addresses answer 404, like the real one. Each request is recorded.
export function fakeServer(routes) {
    const requests = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const request = new Request(new URL(String(input), "http://franzplay.test"), init);
        requests.push(request);
        const answer = routes[`${request.method} ${new URL(request.url).pathname}`];
        if (!answer) {
            return json({ error: "not found" }, 404);
        }
        if (typeof answer === "function") {
            return answer(request);
        }
        return answer.status === 204
            ? new Response(null, { status: 204 })
            : json(answer.body, answer.status);
    });
    return { spy, requests };
}
function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
// emptyLibrary are the routes of a FranzPLAY with no videos yet.
export const emptyLibrary = {
    "GET /api/videos": { body: { videos: [], total: 0 } },
    "GET /api/categories": { body: [] },
    "GET /api/continue": { body: [] },
    "GET /api/home": { body: { closed: [], look: { columns: 0, size: 3, sections: "one" } } },
    "GET /api/health": { body: { status: "ok", version: "test" } },
    "GET /api/site": { body: { nameFirst: "Franz", nameSecond: "PLAY", color: "#2997ff" } },
};
// signedIn are the routes of a server where Paolo is logged in.
export function signedIn(account = testAccount) {
    return { ...emptyLibrary, "GET /api/me": { body: account } };
}
// renderApp shows the whole interface at the given address, without a
// real browser, talking to a fake server (by default: logged in).
export function renderApp(path = "/", routes = signedIn()) {
    const user = userEvent.setup();
    const server = fakeServer(routes);
    const result = render(_jsx(MemoryRouter, { initialEntries: [path], children: _jsx(App, {}) }));
    return { user, server, ...result };
}
