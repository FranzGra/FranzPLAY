// The people of this FranzPLAY, as the administrator manages them.

import { type Account, parseAccount, type Role } from "./auth";
import { request } from "./client";

export type NewPerson = {
  name: string;
  password: string;
  role: Role;
  canUpload: boolean;
};

export async function fetchUsers(signal?: AbortSignal): Promise<Account[]> {
  const data = await request("/api/users", { signal });
  if (!Array.isArray(data)) throw new Error("users: not a list");
  return data.map(parseAccount);
}

export async function createUser(person: NewPerson): Promise<Account> {
  return parseAccount(await request("/api/users", { method: "POST", body: person }));
}

// updateUser changes what a person may do. Without uploadQuota (bytes),
// the person keeps the space they have.
export async function updateUser(
  id: number,
  change: { role: Role; canUpload: boolean; uploadQuota?: number },
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
