// People: everyone on FranzPLAY, to choose who sees something private.

import { request } from "./client";

// Someone a video or a playlist can be shared with.
export type SharePerson = {
  id: number;
  name: string;
  avatar: number; // version of their profile photo, 0 = none
};

export function parseSharePerson(data: unknown): SharePerson {
  if (typeof data !== "object" || data === null) throw new Error("person: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0) {
    throw new Error("person id: not an id");
  }
  if (typeof d.name !== "string" || d.name === "") throw new Error("person name: not a name");
  if (typeof d.avatar !== "number" || !Number.isInteger(d.avatar) || d.avatar < 0) {
    throw new Error("person avatar: not a version");
  }
  return { id: d.id, name: d.name, avatar: d.avatar };
}

// parseSharePeople checks a list of people.
export function parseSharePeople(data: unknown, what: string): SharePerson[] {
  if (!Array.isArray(data)) throw new Error(`${what}: not a list`);
  return data.map(parseSharePerson);
}

// fetchPeople returns everyone on FranzPLAY but me, by name.
export async function fetchPeople(signal?: AbortSignal): Promise<SharePerson[]> {
  return parseSharePeople(await request("/api/people", { signal }), "people");
}
