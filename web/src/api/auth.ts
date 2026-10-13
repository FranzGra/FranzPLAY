// Logging in and out, and who is logged in.

import { isAccentColor } from "../app/accent";
import { ApiError, request } from "./client";

export type Role = "admin" | "user";

// The limits the server checks for names and passwords. The interface
// checks them too, so mistakes show at once and in Italian.
export const nameMin = 3;
export const nameMax = 32;
export const passwordMin = 8;
export const passwordMax = 128;

// nameProblem and passwordProblem explain what is wrong, or return "".
export function nameProblem(name: string): string {
  const n = [...name.trim()].length;
  return n < nameMin || n > nameMax
    ? `Il nome deve avere da ${nameMin} a ${nameMax} caratteri.`
    : "";
}

export function passwordProblem(password: string): string {
  const n = [...password].length;
  return n < passwordMin || n > passwordMax
    ? `La password deve avere da ${passwordMin} a ${passwordMax} caratteri.`
    : "";
}

export type Account = {
  id: number;
  name: string;
  role: Role;
  canUpload: boolean;
  uploadQuota: number; // bytes of uploaded videos the person may keep
  accentColor: string; // "#rrggbb", or "" for FranzPLAY's own
  avatar: number; // version of the profile photo, 0 = none (the initial shows)
};

// parseAccount checks a user sent by the server, once, at the edge.
export function parseAccount(data: unknown): Account {
  if (typeof data !== "object" || data === null) {
    throw new Error("account: response is not an object");
  }
  const { id, name, role, canUpload, uploadQuota, accentColor, avatar } = data as Record<
    string,
    unknown
  >;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("account: bad id");
  }
  if (typeof name !== "string" || name === "") {
    throw new Error("account: bad name");
  }
  if (role !== "admin" && role !== "user") {
    throw new Error(`account: unknown role ${JSON.stringify(role)}`);
  }
  if (typeof canUpload !== "boolean") {
    throw new Error("account: bad canUpload");
  }
  if (typeof uploadQuota !== "number" || !Number.isSafeInteger(uploadQuota) || uploadQuota < 0) {
    throw new Error("account: bad uploadQuota");
  }
  if (typeof accentColor !== "string" || (accentColor !== "" && !isAccentColor(accentColor))) {
    throw new Error("account: bad accentColor");
  }
  if (typeof avatar !== "number" || !Number.isInteger(avatar) || avatar < 0) {
    throw new Error("account: bad avatar");
  }
  return { id, name, role, canUpload, uploadQuota, accentColor, avatar };
}

// fetchMe returns the logged-in user, or null when nobody is logged in.
export async function fetchMe(signal?: AbortSignal): Promise<Account | null> {
  try {
    return parseAccount(await request("/api/me", { signal }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

// SetupStatus is what the login page needs to know before anyone logs in.
export type SetupStatus = {
  needed: boolean; // FranzPLAY still waits for its administrator
  codeNeeded: boolean; // creating it asks for the code written in the log
  openRegistration: boolean; // anyone may create an account by themselves
};

// fetchSetup asks the server what the login page should offer.
export async function fetchSetup(signal?: AbortSignal): Promise<SetupStatus> {
  const data = await request("/api/setup", { signal });
  if (typeof data !== "object" || data === null) {
    throw new Error("setup: response is not an object");
  }
  const { needed, codeNeeded, openRegistration } = data as Record<string, unknown>;
  if (typeof needed !== "boolean") {
    throw new Error("setup: missing needed");
  }
  if (typeof codeNeeded !== "boolean") {
    throw new Error("setup: missing codeNeeded");
  }
  if (typeof openRegistration !== "boolean") {
    throw new Error("setup: missing openRegistration");
  }
  return { needed, codeNeeded, openRegistration };
}

export async function login(name: string, password: string): Promise<Account> {
  return parseAccount(await request("/api/login", { method: "POST", body: { name, password } }));
}

// setup creates the administrator. code is "" unless the server asks for
// the one written in its log.
export async function setup(code: string, name: string, password: string): Promise<Account> {
  return parseAccount(
    await request("/api/setup", { method: "POST", body: { code, name, password } }),
  );
}

// register creates my account without an invite, when the administrator
// allows it, and logs me in.
export async function register(name: string, password: string): Promise<Account> {
  return parseAccount(await request("/api/register", { method: "POST", body: { name, password } }));
}

// fetchRegistration tells the administrator whether anyone may register.
export async function fetchRegistration(signal?: AbortSignal): Promise<boolean> {
  return parseRegistration(await request("/api/registration", { signal }));
}

// saveRegistration lets anyone register (true) or only invited people (false).
export async function saveRegistration(open: boolean): Promise<boolean> {
  return parseRegistration(await request("/api/registration", { method: "PUT", body: { open } }));
}

function parseRegistration(data: unknown): boolean {
  if (typeof data !== "object" || data === null) {
    throw new Error("registration: response is not an object");
  }
  const { open } = data as Record<string, unknown>;
  if (typeof open !== "boolean") {
    throw new Error("registration: missing open");
  }
  return open;
}

export async function logout(): Promise<void> {
  await request("/api/logout", { method: "POST" });
}

// changePassword sets a new password; the other devices are logged out.
export async function changePassword(current: string, next: string): Promise<void> {
  await request("/api/me/password", { method: "POST", body: { current, new: next } });
}

// rename changes my name, which is also the one I log in with.
export async function rename(name: string): Promise<Account> {
  return parseAccount(await request("/api/me/name", { method: "PUT", body: { name } }));
}

// deleteMe removes my account and everything of mine, after checking my
// password once more.
export async function deleteMe(password: string): Promise<void> {
  await request("/api/me", { method: "DELETE", body: { password } });
}

// setAccentColor saves the color I chose for the interface ("" for
// FranzPLAY's own).
export async function setAccentColor(color: string): Promise<Account> {
  return parseAccount(await request("/api/me/color", { method: "PUT", body: { color } }));
}

// avatarUrl is the address of someone's profile photo, or "" when they
// have none. The version in it changes with each new photo.
export function avatarUrl(id: number, version: number): string {
  return version > 0 ? `/api/users/${id}/avatar?v=${version}` : "";
}

// setAvatar saves a square picture as my profile photo.
export async function setAvatar(photo: Blob): Promise<Account> {
  return parseAccount(await request("/api/me/avatar", { method: "PUT", body: photo }));
}

// removeAvatar takes my profile photo away: my initial shows again.
export async function removeAvatar(): Promise<Account> {
  return parseAccount(await request("/api/me/avatar", { method: "DELETE" }));
}
