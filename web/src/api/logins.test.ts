import { fakeServer } from "../test/render";
import { fetchBlocks, fetchLogins, unblock } from "./logins";

const entered = {
  id: 9,
  at: "2026-10-11T20:30:00Z",
  name: "Anna",
  address: "192.168.1.20",
  outcome: "entered",
};

const block = {
  key: "address:10.0.0.7",
  kind: "address",
  value: "10.0.0.7",
  level: 2,
  until: "2026-10-11T21:00:00Z",
};

describe("fetchLogins", () => {
  it("asks for everything when there is no filter", async () => {
    const { requests } = fakeServer({
      "GET /api/logins": { body: { logins: [entered], more: false } },
    });
    const page = await fetchLogins({ search: "", onlyFailed: false });
    expect(new URL(requests[0]?.url ?? "").search).toBe("");
    expect(page).toEqual({
      logins: [{ ...entered, at: new Date("2026-10-11T20:30:00Z") }],
      more: false,
    });
  });

  it("puts the filter in the address, the search without spaces around", async () => {
    const { requests } = fakeServer({ "GET /api/logins": { body: { logins: [], more: true } } });
    const page = await fetchLogins({ search: "  Niccolò & co ", onlyFailed: true, before: 40 });
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("q")).toBe("Niccolò & co");
    expect(query.get("failed")).toBe("1");
    expect(query.get("before")).toBe("40");
    expect(page.more).toBe(true);
  });

  it("leaves out a search made only of spaces", async () => {
    const { requests } = fakeServer({ "GET /api/logins": { body: { logins: [], more: false } } });
    await fetchLogins({ search: "   ", onlyFailed: false, before: 0 });
    expect(new URL(requests[0]?.url ?? "").search).toBe("");
  });

  it.each(["wrong_password", "locked"])("reads the outcome %s", async (outcome) => {
    fakeServer({
      "GET /api/logins": { body: { logins: [{ ...entered, outcome }], more: false } },
    });
    const page = await fetchLogins({ search: "", onlyFailed: false });
    expect(page.logins[0]?.outcome).toBe(outcome);
  });

  it.each([
    ["not an object", null],
    ["no list", { more: false }],
    ["no more", { logins: [] }],
    ["an entry that is not an object", { logins: [null], more: false }],
    ["a zero id", { logins: [{ ...entered, id: 0 }], more: false }],
    ["a fractional id", { logins: [{ ...entered, id: 1.5 }], more: false }],
    ["a bad date", { logins: [{ ...entered, at: "ieri" }], more: false }],
    ["a name that is not text", { logins: [{ ...entered, name: 3 }], more: false }],
    ["no address", { logins: [{ ...entered, address: undefined }], more: false }],
    ["an unknown outcome", { logins: [{ ...entered, outcome: "maybe" }], more: false }],
  ])("refuses an answer with %s", async (_label, body) => {
    fakeServer({ "GET /api/logins": { body } });
    await expect(fetchLogins({ search: "", onlyFailed: false })).rejects.toThrow();
  });

  it("lets a refusal of the server through", async () => {
    fakeServer({ "GET /api/logins": { status: 403, body: { error: "admin only" } } });
    await expect(fetchLogins({ search: "", onlyFailed: false })).rejects.toMatchObject({
      status: 403,
      message: "admin only",
    });
  });
});

describe("fetchBlocks", () => {
  it("reads the blocks with their end", async () => {
    fakeServer({ "GET /api/logins/blocks": { body: [block, { ...block, kind: "account" }] } });
    const blocks = await fetchBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ ...block, until: new Date("2026-10-11T21:00:00Z") });
    expect(blocks[1]?.kind).toBe("account");
  });

  it.each([
    ["not a list", {}],
    ["an entry that is not an object", [null]],
    ["an empty key", [{ ...block, key: "" }]],
    ["an unknown kind", [{ ...block, kind: "device" }]],
    ["a value that is not text", [{ ...block, value: 7 }]],
    ["a fractional level", [{ ...block, level: 1.5 }]],
    ["a bad end", [{ ...block, until: "domani" }]],
  ])("refuses %s", async (_label, body) => {
    fakeServer({ "GET /api/logins/blocks": { body } });
    await expect(fetchBlocks()).rejects.toThrow();
  });
});

describe("unblock", () => {
  it("sends the key to let in again", async () => {
    const { requests } = fakeServer({ "POST /api/logins/unblock": { status: 204 } });
    await unblock("account:Anna");
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ key: "account:Anna" });
  });
});
