// The people of this FranzPLAY, as the administrator manages them.

import { type Account, parseAccount, type Role } from "./auth";
import { request } from "./client";

export type NewPerson = {
  name: string;
  password: string;
  role: Role;
  canUpload: boolean;
};

// Person is someone in the list of people: an account, and when they last
// entered with name and password (null if never).
export type Person = Account & { lastLogin: Date | null };

function parsePerson(data: unknown): Person {
  const account = parseAccount(data);
  const { lastLogin } = data as Record<string, unknown>;
  if (lastLogin === null) return { ...account, lastLogin: null };
  if (typeof lastLogin !== "string" || Number.isNaN(Date.parse(lastLogin))) {
    throw new Error("person: bad lastLogin");
  }
  return { ...account, lastLogin: new Date(lastLogin) };
}

export async function fetchUsers(signal?: AbortSignal): Promise<Person[]> {
  const data = await request("/api/users", { signal });
  if (!Array.isArray(data)) throw new Error("users: not a list");
  return data.map(parsePerson);
}

export async function createUser(person: NewPerson): Promise<Account> {
  return parseAccount(await request("/api/users", { method: "POST", body: person }));
}

// updateUser changes what a person may do. Without uploadQuota (bytes),
// the person keeps the space they have; without canSharePublic, whether
// they may make public links.
export async function updateUser(
  id: number,
  change: { role: Role; canUpload: boolean; uploadQuota?: number; canSharePublic?: boolean },
): Promise<Account> {
  return parseAccount(await request(`/api/users/${id}`, { method: "PUT", body: change }));
}

// resetPassword gives a person a new password; they are logged out everywhere.
export async function resetPassword(id: number, password: string): Promise<void> {
  await request(`/api/users/${id}/password`, { method: "PUT", body: { password } });
}

export async function deleteUser(id: number): Promise<void> {
  await request(`/api/users/${id}`, { method: "DELETE" });
}
