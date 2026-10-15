import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { Account } from "../api/auth";
import { App } from "../app/App";

export const testAccount: Account = {
  id: 1,
  name: "Paolo",
  role: "admin",
  canUpload: true,
  canSharePublic: false,
  uploadQuota: 10737418240,
  accentColor: "",
  avatar: 0,
};

// A route of the fake server: what it answers to "METHOD /path".
type Answer =
  | { status?: number; body?: unknown }
  | ((request: Request) => Response | Promise<Response>);
export type Routes = Record<string, Answer>;

// fakeServer replaces fetch() with a small pretend server. Unknown
// addresses answer 404, like the real one. Each request is recorded.
export function fakeServer(routes: Routes) {
  const requests: Request[] = [];
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// emptyLibrary are the routes of a FranzPLAY with no videos yet.
export const emptyLibrary: Routes = {
  "GET /api/videos": { body: { videos: [], total: 0 } },
  "GET /api/categories": { body: [] },
  "GET /api/continue": { body: [] },
  "GET /api/home": { body: { closed: [], look: { columns: 0, size: 3, sections: "one" } } },
  "GET /api/health": { body: { status: "ok", version: "test" } },
  "GET /api/site": { body: { nameFirst: "Franz", nameSecond: "PLAY", color: "#2997ff" } },
};

// signedIn are the routes of a server where Paolo is logged in.
export function signedIn(account: Account = testAccount): Routes {
  return { ...emptyLibrary, "GET /api/me": { body: account } };
}

// renderApp shows the whole interface at the given address, without a
// real browser, talking to a fake server (by default: logged in).
export function renderApp(path = "/", routes: Routes = signedIn()) {
  const user = userEvent.setup();
  const server = fakeServer(routes);
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { user, server, ...result };
}
