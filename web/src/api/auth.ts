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

// The ways to log in: a password, a PIN of exactly pinLength digits, or a
// pattern joining at least patternMin dots of a 3×3 grid. A pattern is
// written as the numbers of its dots in order, 1 to 9 row by row: "14789".
export type Method = "password" | "pin" | "pattern";
export const methods: readonly Method[] = ["password", "pin", "pattern"];
export const pinLength = 6;
export const patternMin = 5;

export const methodNames: Record<Method, string> = {
  password: "Password",
  pin: "PIN",
  pattern: "Sequenza",
};

export function isMethod(value: unknown): value is Method {
  return value === "password" || value === "pin" || value === "pattern";
}

function parseMethodList(value: unknown, what: string): Method[] {
  if (!Array.isArray(value) || !value.every(isMethod)) {
    throw new Error(`${what}: bad method list`);
  }
  return value;
}

// secretProblem explains what is wrong with a new password, PIN or pattern.
export function secretProblem(method: Method, secret: string): string {
  switch (method) {
    case "password":
      return passwordProblem(secret);
    case "pin":
      return new RegExp(`^[0-9]{${pinLength}}$`).test(secret)
        ? ""
        : `Il PIN deve avere esattamente ${pinLength} cifre.`;
    case "pattern":
      return /^[1-9]+$/.test(secret) &&
        new Set(secret).size === secret.length &&
        secret.length >= patternMin
        ? ""
        : `La sequenza deve unire almeno ${patternMin} punti.`;
  }
}

export type Account = {
  id: number;
  name: string;
  role: Role;
  canUpload: boolean;
  // canSharePublic: the administrator lets them make public links (see
  // maySharePublic, administrators always may).
  canSharePublic: boolean;
  uploadQuota: number; // bytes of uploaded videos the person may keep
  accentColor: string; // "#rrggbb", or "" for FranzPLAY's own
  avatar: number; // version of the profile photo, 0 = none (the initial shows)
  skipSeconds: number; // how far the player jumps forward or back
  loginMethod: Method; // how I log in
  allowedMethods: Method[]; // what I may choose
  ownMethods: Method[] | null; // the administrator's narrowing, null = the server's choice
  // mustChooseMethod: the administrator removed my method; I must pick another.
  mustChooseMethod: boolean;
};

// skipChoices are the jumps a person may choose for the player, in seconds.
const skipChoices = [5, 10, 15, 20, 30];

// parseAccount checks a user sent by the server, once, at the edge.
export function parseAccount(data: unknown): Account {
  if (typeof data !== "object" || data === null) {
    throw new Error("account: response is not an object");
  }
  const {
    id,
    name,
    role,
    canUpload,
    canSharePublic,
    uploadQuota,
    accentColor,
    avatar,
    loginMethod,
    allowedMethods,
    ownMethods,
    mustChooseMethod,
    skipSeconds,
  } = data as Record<string, unknown>;
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
  if (skipSeconds !== undefined && !skipChoices.includes(skipSeconds as number)) {
    throw new Error("account: bad skipSeconds");
  }
  // An older server does not send canSharePublic: then nobody may; nor
  // skipSeconds: then the player's own 15.
  // An older server sends neither canSharePublic nor the methods.
  const method = isMethod(loginMethod) ? loginMethod : "password";
  return {
    id,
    name,
    role,
    canUpload,
    canSharePublic: canSharePublic === true,
    uploadQuota,
    accentColor,
    avatar,
    skipSeconds: typeof skipSeconds === "number" ? skipSeconds : 15,
    loginMethod: method,
    allowedMethods:
      allowedMethods === undefined || allowedMethods === null
        ? [method]
        : parseMethodList(allowedMethods, "account"),
    ownMethods:
      ownMethods === undefined || ownMethods === null
        ? null
        : parseMethodList(ownMethods, "account"),
    mustChooseMethod: mustChooseMethod === true,
  };
}

// maySharePublic says whether someone may make public links: an
// administrator always, anyone else when the administrator allowed it.
export function maySharePublic(account: Account): boolean {
  return account.role === "admin" || account.canSharePublic;
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
  methods: Method[]; // the login methods a new account may choose
};

// fetchSetup asks the server what the login page should offer.
export async function fetchSetup(signal?: AbortSignal): Promise<SetupStatus> {
  const data = await request("/api/setup", { signal });
  if (typeof data !== "object" || data === null) {
    throw new Error("setup: response is not an object");
  }
  const {
    needed,
    codeNeeded,
    openRegistration,
    methods: allowed,
  } = data as Record<string, unknown>;
  if (typeof needed !== "boolean") {
    throw new Error("setup: missing needed");
  }
  if (typeof codeNeeded !== "boolean") {
    throw new Error("setup: missing codeNeeded");
  }
  if (typeof openRegistration !== "boolean") {
    throw new Error("setup: missing openRegistration");
  }
  return {
    needed,
    codeNeeded,
    openRegistration,
    methods: allowed === undefined ? ["password"] : parseMethodList(allowed, "setup"),
  };
}

// loginMethod asks how a name logs in, to show the right field after it.
// A name that does not exist gets an answer too, so it reveals nothing.
export async function loginMethod(name: string): Promise<Method> {
  const data = await request("/api/login/method", { method: "POST", body: { name } });
  const method = (data as Record<string, unknown> | null)?.method;
  if (!isMethod(method)) throw new Error("login method: bad answer");
  return method;
}

// login sends the password, the PIN or the pattern.
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
export async function register(name: string, method: Method, password: string): Promise<Account> {
  return parseAccount(
    await request("/api/register", { method: "POST", body: { name, method, password } }),
  );
}

// fetchServerMethods tells the administrator which methods people may use.
export async function fetchServerMethods(signal?: AbortSignal): Promise<Method[]> {
  return parseServerMethods(await request("/api/login-methods", { signal }));
}

export async function saveServerMethods(list: Method[]): Promise<Method[]> {
  return parseServerMethods(
    await request("/api/login-methods", { method: "PUT", body: { methods: list } }),
  );
}

function parseServerMethods(data: unknown): Method[] {
  return parseMethodList((data as Record<string, unknown> | null)?.methods, "login methods");
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

// changeCredential sets my new password, PIN or pattern, after checking
// the current one; the other devices are logged out.
export async function changeCredential(
  current: string,
  method: Method,
  secret: string,
): Promise<void> {
  await request("/api/me/credential", { method: "PUT", body: { current, method, secret } });
}

// checkCredential confirms my current password, PIN or pattern; a wrong
// one is refused with 403 and counts as a wrong try.
export async function checkCredential(current: string): Promise<void> {
  await request("/api/me/check", { method: "POST", body: { current } });
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

// setSkipSeconds saves how far the player jumps for me (5, 10, 15, 20 or 30).
export async function setSkipSeconds(seconds: number): Promise<Account> {
  return parseAccount(await request("/api/me/skip", { method: "PUT", body: { seconds } }));
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
