// The "is the server alive?" call: GET /api/health.
import { request } from "./client";
// parseServerInfo checks the server's answer once, at the edge.
// After this, the rest of the interface can trust the data.
export function parseServerInfo(data) {
    if (typeof data !== "object" || data === null) {
        throw new Error("health: response is not an object");
    }
    const { status, version } = data;
    if (status !== "ok") {
        throw new Error(`health: unexpected status ${JSON.stringify(status)}`);
    }
    if (typeof version !== "string" || version === "") {
        throw new Error("health: missing version");
    }
    return { status, version };
}
export async function fetchServerInfo(signal) {
    return parseServerInfo(await request("/api/health", { signal }));
}
