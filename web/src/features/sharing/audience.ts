// Who sees something private: everybody, only me, or the people I choose.

export type Audience = "everyone" | "me" | "people";

// Choice is an audience with the people chosen, by id; people counts only
// for "people".
export type Choice = { audience: Audience; people: number[] };

// choiceOf reads the choice of something from the server's answer.
export function choiceOf(isPrivate: boolean, sharedWith: { id: number }[]): Choice {
  if (!isPrivate) return { audience: "everyone", people: [] };
  if (sharedWith.length === 0) return { audience: "me", people: [] };
  return { audience: "people", people: sharedWith.map((p) => p.id) };
}

// sharing is the choice as the server takes it.
export function sharing(choice: Choice): { private: boolean; sharedWith: number[] } {
  return {
    private: choice.audience !== "everyone",
    sharedWith: choice.audience === "people" ? choice.people : [],
  };
}

// ready says whether the choice can be saved: "people" needs someone.
export function ready(choice: Choice): boolean {
  return choice.audience !== "people" || choice.people.length > 0;
}

// seenBy says in a few words who sees it, for the lists: "lo vedono
// tutti", "solo tu lo vedi", "lo vedono anche Anna e Marco".
export function seenBy(isPrivate: boolean, sharedWith: { name: string }[]): string {
  if (!isPrivate) return "lo vedono tutti";
  if (sharedWith.length === 0) return "solo tu lo vedi";
  return `lo vedono anche ${namesList(sharedWith.map((p) => p.name))}`;
}

// namesList joins names the Italian way: "Anna, Luca e Marco". After four
// names it says how many more.
export function namesList(names: string[]): string {
  const shown =
    names.length > 4 ? [...names.slice(0, 3), `altre ${names.length - 3} persone`] : names;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} e ${shown[shown.length - 1]}`;
}
