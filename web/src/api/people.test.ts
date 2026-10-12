import { parseSharePeople, parseSharePerson } from "./people";

describe("parseSharePerson", () => {
  it("accepts a person", () => {
    expect(parseSharePerson({ id: 3, name: "Anna", avatar: 2 })).toEqual({
      id: 3,
      name: "Anna",
      avatar: 2,
    });
  });

  it.each([
    ["not an object", null],
    ["no id", { id: 0, name: "Anna", avatar: 0 }],
    ["no name", { id: 3, name: "", avatar: 0 }],
    ["no avatar", { id: 3, name: "Anna" }],
  ])("refuses %s", (_, data) => {
    expect(() => parseSharePerson(data)).toThrow();
  });

  it("refuses what is not a list", () => {
    expect(() => parseSharePeople({}, "people")).toThrow("people: not a list");
  });
});
