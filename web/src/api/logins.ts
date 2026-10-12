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
