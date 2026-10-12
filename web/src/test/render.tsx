import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../app/App";

// renderApp shows the whole interface at the given address, without a real browser.
export function renderApp(path = "/") {
  const user = userEvent.setup();
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return { user, ...result };
}

// mockFetchJSON makes every fetch() answer with the given JSON body.
export function mockFetchJSON(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}
