// Invites: links that let family and friends create their own account.

import { type Account, type Method, parseAccount } from "./auth";
import { ApiError, request } from "./client";

export type InviteStatus = "waiting" | "used" | "expired";

export type Invite = {
  id: number;
  note: string; // who it is for, to remember
  canUpload: boolean;
  createdBy: string; // "" if that administrator was removed
  createdAt: Date;
  expiresAt: Date;
  status: InviteStatus;
  usedBy: string; // who joined with it
};

// maxNoteLength is the longest note the server accepts.
export const maxNoteLength = 60;

const statuses: readonly string[] = ["waiting", "used", "expired"];

function date(v: unknown, what: string): Date {
  const d = typeof v === "string" ? new Date(v) : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) throw new Error(`invite ${what}: not a date`);
  return d;
}

export function parseInvite(data: unknown): Invite {
  if (typeof data !== "object" || data === null) throw new Error("invite: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0) {
    throw new Error("invite id: not an id");
  }
  if (typeof d.note !== "string") throw new Error("invite note: not a text");
  if (typeof d.canUpload !== "boolean") throw new Error("invite canUpload: not true or false");
  if (typeof d.createdBy !== "string") throw new Error("invite createdBy: not a text");
  if (typeof d.status !== "string" || !statuses.includes(d.status)) {
    throw new Error(`invite status: unknown ${JSON.stringify(d.status)}`);
  }
  if (typeof d.usedBy !== "string") throw new Error("invite usedBy: not a text");
  return {
    id: d.id,
    note: d.note,
    canUpload: d.canUpload,
    createdBy: d.createdBy,
    createdAt: date(d.createdAt, "createdAt"),
    expiresAt: date(d.expiresAt, "expiresAt"),
    status: d.status as InviteStatus,
    usedBy: d.usedBy,
  };
}

export async function fetchInvites(signal?: AbortSignal): Promise<Invite[]> {
  const data = await request("/api/invites", { signal });
  if (!Array.isArray(data)) throw new Error("invites: not a list");
  return data.map(parseInvite);
}

// createInvite makes an invite. Its code comes only now: the server keeps
// just a fingerprint of it, so the link cannot be shown again later.
export async function createInvite(
  note: string,
  canUpload: boolean,
): Promise<{ invite: Invite; code: string }> {
  const data = await request("/api/invites", { method: "POST", body: { note, canUpload } });
  const code = (data as Record<string, unknown> | undefined)?.code;
  if (typeof code !== "string" || code === "") throw new Error("invite: missing code");
  return { invite: parseInvite(data), code };
}

export async function deleteInvite(id: number): Promise<void> {
  await request(`/api/invites/${id}`, { method: "DELETE" });
}

// inviteLink is the address to send. The code is after "#": browsers never
// send that part to the server, so it does not end up in any log.
export function inviteLink(code: string, origin = window.location.origin): string {
  return `${origin}/invito#${code}`;
}

// checkInvite tells whether the code of a link still works.
export async function checkInvite(code: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await request("/api/join/check", { method: "POST", body: { code }, signal });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 410) return false;
    throw error;
  }
}

// join creates the account of someone invited, and logs them in.
export async function join(
  code: string,
  name: string,
  password: string,
  method: Method = "password",
): Promise<Account> {
  return parseAccount(
    await request("/api/join", { method: "POST", body: { code, name, method, password } }),
  );
}
