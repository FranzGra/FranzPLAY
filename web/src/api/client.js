// The one place that talks to the server's API. Every answer goes through
// here, so errors look the same everywhere.
// ApiError is a refusal from the server, with its HTTP status and message.
export class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}
const unauthorizedListeners = new Set();
// onUnauthorized calls listener whenever the server says the login is no
// longer valid (for example the session expired), so the interface can
// show the login page again. It returns a function that stops listening.
export function onUnauthorized(listener) {
    unauthorizedListeners.add(listener);
    return () => unauthorizedListeners.delete(listener);
}
// request calls the API and returns the JSON answer, not yet checked:
// each caller checks it with its own parse function.
export async function request(path, options = {}) {
    const { method = "GET", body, signal, keepalive } = options;
    const response = await fetch(path, {
        method,
        signal,
        keepalive,
        headers: body === undefined ? undefined : { "Content-Type": contentType(body) },
        body: body === undefined || body instanceof Blob ? body : JSON.stringify(body),
    });
    if (response.status === 204) {
        return undefined;
    }
    const data = await response.json().catch(() => undefined);
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
function contentType(body) {
    if (body instanceof Blob) {
        return body.type || "application/octet-stream";
    }
    return "application/json";
}
function errorMessage(data, status) {
    if (typeof data === "object" && data !== null) {
        const { error } = data;
        if (typeof error === "string" && error !== "") {
            return error;
        }
    }
    return `the server answered ${status}`;
}
