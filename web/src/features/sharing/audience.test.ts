import { choiceOf, namesList, playlistSharing, ready, seenBy, sharing } from "./audience";

const link = "/video/12?k=abcdefghijklmnopqrstuv";

describe("audience", () => {
  it("reads the choice from the server", () => {
    expect(choiceOf(false, [])).toEqual({ audience: "everyone", people: [] });
    expect(choiceOf(true, [])).toEqual({ audience: "me", people: [] });
    expect(choiceOf(true, [{ id: 3 }, { id: 5 }])).toEqual({ audience: "people", people: [3, 5] });
    expect(choiceOf(true, [], link)).toEqual({ audience: "link", people: [] });
  });

  it("turns the choice into what the server takes", () => {
    expect(sharing({ audience: "everyone", people: [3] })).toEqual({
      private: false,
      sharedWith: [],
      byLink: false,
    });
    expect(sharing({ audience: "me", people: [3] })).toEqual({
      private: true,
      sharedWith: [],
      byLink: false,
    });
    expect(sharing({ audience: "people", people: [3] })).toEqual({
      private: true,
      sharedWith: [3],
      byLink: false,
    });
    expect(sharing({ audience: "link", people: [3] })).toEqual({
      private: true,
      sharedWith: [],
      byLink: true,
    });
    expect(playlistSharing({ audience: "everyone", people: [3] })).toEqual({
      public: true,
      sharedWith: [],
    });
    expect(playlistSharing({ audience: "people", people: [3] })).toEqual({
      public: false,
      sharedWith: [3],
    });
  });

  it("needs someone for some people", () => {
    expect(ready({ audience: "people", people: [] })).toBe(false);
    expect(ready({ audience: "people", people: [2] })).toBe(true);
    expect(ready({ audience: "me", people: [] })).toBe(true);
  });

  it("says who sees it", () => {
    expect(seenBy(false, [])).toBe("lo vedono tutti");
    expect(seenBy(true, [])).toBe("solo tu lo vedi");
    expect(seenBy(true, [], link)).toBe("lo vede chi ha il link");
    expect(seenBy(true, [{ name: "Anna" }, { name: "Marco" }])).toBe(
      "lo vedono anche Anna e Marco",
    );
  });

  it("joins names", () => {
    expect(namesList(["Anna"])).toBe("Anna");
    expect(namesList(["Anna", "Luca", "Marco"])).toBe("Anna, Luca e Marco");
    expect(namesList(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C e altre 3 persone");
  });
});
