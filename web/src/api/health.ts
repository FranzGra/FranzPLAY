// The "is the server alive?" call: GET /api/health.

import { request } from "./client";

export type ServerInfo = {
  status: "ok";
  version: string;
};

// parseServerInfo checks the server's answer once, at the edge.
// After this, the rest of the interface can trust the data.
export function parseServerInfo(data: unknown): ServerInfo {
  if (typeof data !== "object" || data === null) {
    throw new Error("health: response is not an object");
  }
  const { status, version } = data as Record<string, unknown>;
  if (status !== "ok") {
    throw new Error(`health: unexpected status ${JSON.stringify(status)}`);
  }
  if (typeof version !== "string" || version === "") {
    throw new Error("health: missing version");
  }
  return { status, version };
}

export async function fetchServerInfo(signal?: AbortSignal): Promise<ServerInfo> {
  return parseServerInfo(await request("/api/health", { signal }));
}
