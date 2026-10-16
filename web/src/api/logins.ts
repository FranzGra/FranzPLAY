// The access log: who tried to log in, when and from where.

import { request } from "./client";

export type Outcome = "entered" | "wrong_password" | "locked";

export type Login = {
  id: number;
  at: Date;
  name: string;
  address: string;
  outcome: Outcome;
};

export type LoginPage = { logins: Login[]; more: boolean };

export type LoginFilter = {
  search: string; // part of the name or of the address
  onlyFailed: boolean;
  before?: number; // only entries older than this id
};

function parseLogin(data: unknown): Login {
  if (typeof data !== "object" || data === null) throw new Error("login: not an object");
  const { id, at, name, address, outcome } = data as Record<string, unknown>;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) throw new Error("login: bad id");
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new Error("login: bad at");
  if (typeof name !== "string") throw new Error("login: bad name");
  if (typeof address !== "string") throw new Error("login: bad address");
  if (outcome !== "entered" && outcome !== "wrong_password" && outcome !== "locked") {
    throw new Error(`login: unknown outcome ${JSON.stringify(outcome)}`);
  }
  return { id, at: new Date(at), name, address, outcome };
}

export async function fetchLogins(filter: LoginFilter, signal?: AbortSignal): Promise<LoginPage> {
  const q = new URLSearchParams();
  if (filter.search.trim()) q.set("q", filter.search.trim());
  if (filter.onlyFailed) q.set("failed", "1");
  if (filter.before) q.set("before", String(filter.before));
  const query = q.toString();
  const data = await request(`/api/logins${query ? `?${query}` : ""}`, { signal });
  if (typeof data !== "object" || data === null) throw new Error("logins: not an object");
  const { logins, more } = data as Record<string, unknown>;
  if (!Array.isArray(logins) || typeof more !== "boolean") throw new Error("logins: bad page");
  return { logins: logins.map(parseLogin), more };
}

// Block is a name or an address that may not try to log in until until,
// after too many wrong tries.
export type Block = {
  key: string;
  kind: "account" | "address";
  value: string;
  level: number; // blocks in a row: each one lasts longer
  until: Date;
};

function parseBlock(data: unknown): Block {
  if (typeof data !== "object" || data === null) throw new Error("block: not an object");
  const { key, kind, value, level, until } = data as Record<string, unknown>;
  if (typeof key !== "string" || key === "") throw new Error("block: bad key");
  if (kind !== "account" && kind !== "address") throw new Error("block: bad kind");
  if (typeof value !== "string") throw new Error("block: bad value");
  if (typeof level !== "number" || !Number.isInteger(level)) throw new Error("block: bad level");
  if (typeof until !== "string" || Number.isNaN(Date.parse(until))) {
    throw new Error("block: bad until");
  }
  return { key, kind, value, level, until: new Date(until) };
}

export async function fetchBlocks(signal?: AbortSignal): Promise<Block[]> {
  const data = await request("/api/logins/blocks", { signal });
  if (!Array.isArray(data)) throw new Error("blocks: not a list");
  return data.map(parseBlock);
}

// unblock lets a name or an address try again at once.
export async function unblock(key: string): Promise<void> {
  await request("/api/logins/unblock", { method: "POST", body: { key } });
}
