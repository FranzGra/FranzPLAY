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
    expect(parseAccount(giulia)).toEqual(giulia);
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
  ])("rejects %s", (_label, data) => {
    expect(() => parseAccount(data)).toThrow();
  });
});
