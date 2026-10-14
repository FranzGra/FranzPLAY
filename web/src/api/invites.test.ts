import { inviteLink, parseInvite } from "./invites";

const invite = (over: Record<string, unknown> = {}) => ({
  id: 4,
  note: "Nonna Maria",
  canUpload: false,
  createdBy: "Paolo",
  createdAt: "2026-10-12T10:00:00Z",
  expiresAt: "2026-10-19T10:00:00Z",
  status: "waiting",
  usedBy: "",
  ...over,
});

describe("parseInvite", () => {
  it("accepts an invite", () => {
    expect(parseInvite(invite())).toEqual({
      id: 4,
      note: "Nonna Maria",
      canUpload: false,
      createdBy: "Paolo",
      createdAt: new Date("2026-10-12T10:00:00Z"),
      expiresAt: new Date("2026-10-19T10:00:00Z"),
      status: "waiting",
      usedBy: "",
    });
  });

  it.each([
    ["an unknown status", { status: "lost" }],
    ["a bad date", { expiresAt: "domani" }],
    ["a bad id", { id: 0 }],
    ["no note", { note: null }],
  ])("refuses %s", (_, over) => {
    expect(() => parseInvite(invite(over))).toThrow();
  });
});

describe("inviteLink", () => {
  it("keeps the code after #, where browsers do not send it to the server", () => {
    expect(inviteLink("abc_123", "http://casa.local:8090")).toBe(
      "http://casa.local:8090/invito#abc_123",
    );
  });
});
