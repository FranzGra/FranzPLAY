import { choiceOf, namesList, ready, seenBy, sharing } from "./audience";
describe("audience", () => {
    it("reads the choice from the server", () => {
        expect(choiceOf(false, [])).toEqual({ audience: "everyone", people: [] });
        expect(choiceOf(true, [])).toEqual({ audience: "me", people: [] });
        expect(choiceOf(true, [{ id: 3 }, { id: 5 }])).toEqual({ audience: "people", people: [3, 5] });
    });
    it("turns the choice into what the server takes", () => {
        expect(sharing({ audience: "everyone", people: [3] })).toEqual({
            private: false,
            sharedWith: [],
        });
        expect(sharing({ audience: "me", people: [3] })).toEqual({ private: true, sharedWith: [] });
        expect(sharing({ audience: "people", people: [3] })).toEqual({
            private: true,
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
        expect(seenBy(true, [{ name: "Anna" }, { name: "Marco" }])).toBe("lo vedono anche Anna e Marco");
    });
    it("joins names", () => {
        expect(namesList(["Anna"])).toBe("Anna");
        expect(namesList(["Anna", "Luca", "Marco"])).toBe("Anna, Luca e Marco");
        expect(namesList(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C e altre 3 persone");
    });
});
