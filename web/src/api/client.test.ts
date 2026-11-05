import { fakeServer } from "../test/render";
import { parseAccount } from "./auth";
import { ApiError, onUnauthorized, request } from "./client";

describe("request", () => {
  it("returns the JSON answer", async () => {
    fakeServer({ "GET /api/x": { body: { a: 1 } } });
    expect(await request("/api/x")).toEqual({ a: 1 });
  });

  it("sends a JSON body", async () => {
    const { requests } = fakeServer({ "POST /api/x": { status: 204 } });
    expect(await request("/api/x", { method: "POST", body: { b: 2 } })).toBeUndefined();
    expect(requests[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(await requests[0]?.json()).toEqual({ b: 2 });
  });

  it("turns a refusal into an ApiError with the server's message", async () => {
    fakeServer({ "GET /api/x": { status: 409, body: { error: "this name is already used" } } });
    await expect(request("/api/x")).rejects.toEqual(new ApiError(409, "this name is already used"));
  });

  it("copes with an answer that is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(request("/api/x")).rejects.toEqual(new ApiError(502, "the server answered 502"));
  });

  it("tells the listeners when the login is no longer valid", async () => {
    fakeServer({ "GET /api/x": { status: 401, body: { error: "login required" } } });
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    await expect(request("/api/x")).rejects.toBeInstanceOf(ApiError);
    stop();
    await expect(request("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("request refusals", () => {
  it.each([
    [400, "bad request"],
    [403, "only the administrator can do this"],
    [404, "not found"],
    [409, "subtitles already there"],
    [413, "the file is too big"],
    [415, "only .srt or .vtt files"],
    [429, "too many tries"],
    [500, "internal error"],
    [503, "the disk is not ready"],
  ])("keeps status %i and the server's message", async (status, message) => {
    fakeServer({ "PUT /api/x": { status, body: { error: message } } });
    const error = await request("/api/x", { method: "PUT", body: { a: 1 } }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: "ApiError", status, message, retryAfter: 0 });
  });

  it("tells the listeners only for 401, not for 403", async () => {
    fakeServer({
      "GET /api/forbidden": { status: 403, body: { error: "admin only" } },
      "GET /api/gone": { status: 401, body: { error: "login required" } },
    });
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    await expect(request("/api/forbidden")).rejects.toMatchObject({ status: 403 });
    expect(listener).not.toHaveBeenCalled();
    await expect(request("/api/gone")).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("tells every listener, and forgets the ones that stopped", async () => {
    fakeServer({ "GET /api/x": { status: 401, body: {} } });
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onUnauthorized(first);
    const stopSecond = onUnauthorized(second);
    await expect(request("/api/x")).rejects.toBeInstanceOf(ApiError);
    stopFirst();
    await expect(request("/api/x")).rejects.toBeInstanceOf(ApiError);
    stopSecond();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("reads how long to wait from Retry-After", async () => {
    fakeServer({
      "POST /api/login": () =>
        new Response(JSON.stringify({ error: "too many tries" }), {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
    });
    await expect(request("/api/login", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 429,
      retryAfter: 30,
    });
  });

  it.each([
    ["missing", undefined],
    ["not a number", "soon"],
    ["zero", "0"],
    ["negative", "-5"],
  ])("ignores a Retry-After that is %s", async (_label, header) => {
    fakeServer({
      "GET /api/x": () =>
        new Response("{}", {
          status: 429,
          headers: header === undefined ? {} : { "Retry-After": header },
        }),
    });
    await expect(request("/api/x")).rejects.toMatchObject({ status: 429, retryAfter: 0 });
  });

  it.each([
    ["an empty error", { error: "" }],
    ["an error that is not text", { error: 42 }],
    ["a list", ["error"]],
    ["null", null],
  ])("falls back to the status for %s", async (_label, body) => {
    fakeServer({ "GET /api/x": { status: 500, body } });
    await expect(request("/api/x")).rejects.toEqual(new ApiError(500, "the server answered 500"));
  });

  it("lets a network failure through as it is, not as an ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    const error = await request("/api/x").catch((e) => e);
    stop();
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(listener).not.toHaveBeenCalled();
  });

  it("lets an abort through as it is", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) =>
      Promise.reject(init?.signal?.reason ?? new DOMException("aborted", "AbortError")),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(request("/api/x", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("returns nothing for an empty success that is not 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    expect(await request("/api/x")).toBeUndefined();
  });
});

describe("request bodies", () => {
  it("sends a file as it is, with its own type", async () => {
    const { requests } = fakeServer({ "PUT /api/sub": { status: 204 } });
    const file = new File(["WEBVTT"], "mare.vtt", { type: "text/vtt" });
    await request("/api/sub", { method: "PUT", body: file });
    expect(requests[0]?.headers.get("Content-Type")).toBe("text/vtt");
    expect(await requests[0]?.text()).toBe("WEBVTT");
  });

  it("names a file without a type as plain bytes", async () => {
    const { requests } = fakeServer({ "PUT /api/sub": { status: 204 } });
    await request("/api/sub", { method: "PUT", body: new Blob(["1"]) });
    expect(requests[0]?.headers.get("Content-Type")).toBe("application/octet-stream");
  });

  it("sends no body and no type when there is nothing to send", async () => {
    const { requests } = fakeServer({ "DELETE /api/x": { status: 204 } });
    await request("/api/x", { method: "DELETE" });
    expect(requests[0]?.headers.get("Content-Type")).toBeNull();
    expect(requests[0]?.body).toBeNull();
  });

  it("keeps accents and emoji in a JSON body", async () => {
    const { requests } = fakeServer({ "POST /api/x": { status: 204 } });
    await request("/api/x", { method: "POST", body: { name: "Perché è così 🎬" } });
    expect(await requests[0]?.json()).toEqual({ name: "Perché è così 🎬" });
  });

  it("asks the browser to finish a keepalive request", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await request("/api/progress", { method: "PUT", body: { at: 1 }, keepalive: true });
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ method: "PUT", keepalive: true });
  });
});

describe("parseAccount", () => {
  const giulia = {
    id: 3,
    name: "Giulia",
    role: "user",
    canUpload: false,
    uploadQuota: 10737418240,
    accentColor: "",
    avatar: 0,
  };

  it("accepts a valid user", () => {
    expect(parseAccount(giulia)).toEqual({
      ...giulia,
      canSharePublic: false,
      skipSeconds: 15,
      loginMethod: "password",
      allowedMethods: ["password"],
      ownMethods: null,
      mustChooseMethod: false,
    });
    const withPIN = parseAccount({
      ...giulia,
      loginMethod: "pin",
      allowedMethods: ["password", "pin"],
      ownMethods: ["password", "pin"],
      mustChooseMethod: true,
    });
    expect(withPIN.loginMethod).toBe("pin");
    expect(withPIN.mustChooseMethod).toBe(true);
    expect(parseAccount({ ...giulia, skipSeconds: 10 }).skipSeconds).toBe(10);
    expect(parseAccount({ ...giulia, canSharePublic: true }).canSharePublic).toBe(true);
  });

  it.each([
    ["null", null],
    ["no id", { ...giulia, id: undefined }],
    ["zero id", { ...giulia, id: 0 }],
    ["empty name", { ...giulia, name: "" }],
    ["unknown role", { ...giulia, role: "root" }],
    ["text canUpload", { ...giulia, canUpload: "yes" }],
    ["no uploadQuota", { ...giulia, uploadQuota: undefined }],
    ["negative uploadQuota", { ...giulia, uploadQuota: -1 }],
    ["fractional uploadQuota", { ...giulia, uploadQuota: 1.5 }],
    ["no accentColor", { ...giulia, accentColor: undefined }],
    ["no avatar", { ...giulia, avatar: undefined }],
    ["negative avatar", { ...giulia, avatar: -1 }],
    ["not a color", { ...giulia, accentColor: "red" }],
    ["a jump not offered", { ...giulia, skipSeconds: 7 }],
    ["text skipSeconds", { ...giulia, skipSeconds: "10" }],
    ["unknown allowed method", { ...giulia, allowedMethods: ["face"] }],
  ])("rejects %s", (_label, data) => {
    expect(() => parseAccount(data)).toThrow();
  });
});
