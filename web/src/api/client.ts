// The one place that talks to the server's API. Every answer goes through
// here, so errors look the same everywhere.

// ApiError is a refusal from the server, with its HTTP status and message.
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

// onUnauthorized calls listener whenever the server says the login is no
// longer valid (for example the session expired), so the interface can
// show the login page again. It returns a function that stops listening.
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  // keepalive lets the request finish even if the page is closing.
  keepalive?: boolean;
};

// request calls the API and returns the JSON answer, not yet checked:
// each caller checks it with its own parse function.
export async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { method = "GET", body, signal, keepalive } = options;
  const response = await fetch(path, {
    method,
    signal,
    keepalive,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) {
    return undefined;
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401) {
      for (const listener of unauthorizedListeners) {
        listener();
      }
    }
    throw new ApiError(response.status, errorMessage(data, response.status));
  }
  return data;
}

function errorMessage(data: unknown, status: number): string {
  if (typeof data === "object" && data !== null) {
    const { error } = data as Record<string, unknown>;
    if (typeof error === "string" && error !== "") {
      return error;
    }
  }
  return `the server answered ${status}`;
}
