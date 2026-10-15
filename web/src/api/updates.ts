// The check for new versions of FranzPLAY, for administrators.

import { request } from "./client";

export type Updates = {
  enabled: boolean; // FranzPLAY asks GitHub once a day
  release: string; // installed version, "" for a development build
  commit: string;
  development: boolean; // built from a commit: never told to update
  checkedAt: string | null; // when GitHub was last asked
  latest: string; // latest official release found, "" when none
  url: string; // its page on GitHub
  notes: string;
  newer: boolean; // latest is newer than the installed version
};

// fetchUpdates reads the installed version and what the last check found.
export async function fetchUpdates(signal?: AbortSignal): Promise<Updates> {
  return parseUpdates(await request("/api/updates", { signal }));
}

// saveUpdateCheck turns the daily check on or off.
export async function saveUpdateCheck(enabled: boolean): Promise<Updates> {
  return parseUpdates(await request("/api/updates", { method: "PUT", body: { enabled } }));
}

// The command that updates FranzPLAY when it runs with Docker Compose.
export const updateCommand = "docker compose pull && docker compose up -d";

function parseUpdates(data: unknown): Updates {
  if (typeof data !== "object" || data === null) {
    throw new Error("updates: response is not an object");
  }
  const d = data as Record<string, unknown>;
  const text = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : "");
  if (typeof d.enabled !== "boolean") throw new Error("updates: missing enabled");
  return {
    enabled: d.enabled,
    release: text("release"),
    commit: text("commit"),
    development: d.development === true,
    checkedAt: typeof d.checkedAt === "string" ? d.checkedAt : null,
    latest: text("latest"),
    url: text("url"),
    notes: text("notes"),
    newer: d.newer === true,
  };
}
