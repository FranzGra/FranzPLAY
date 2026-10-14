// Who sees something private: everybody, only me, the people I choose, or
// (for a video) whoever has its link.

import type { Audience } from "../../api/videos";

export type { Audience };

// Choice is an audience with the people chosen, by id; people counts only
// for "people".
export type Choice = { audience: Audience; people: number[] };

// choiceOf reads the choice of something from the server's answer.
export function choiceOf(
  isPrivate: boolean,
  sharedWith: { id: number }[],
  link: string | null = null,
): Choice {
  if (!isPrivate) return { audience: "everyone", people: [] };
  if (link !== null) return { audience: "link", people: [] };
  if (sharedWith.length === 0) return { audience: "me", people: [] };
  return { audience: "people", people: sharedWith.map((p) => p.id) };
}

// sharing is the choice as the server takes it for a video.
export function sharing(choice: Choice): {
  private: boolean;
  sharedWith: number[];
  byLink: boolean;
} {
  return {
    private: choice.audience !== "everyone",
    sharedWith: choice.audience === "people" ? choice.people : [],
    byLink: choice.audience === "link",
  };
}

// ready says whether the choice can be saved: "people" needs someone.
export function ready(choice: Choice): boolean {
  return choice.audience !== "people" || choice.people.length > 0;
}

// playlistSharing is the choice as the server takes it for a playlist,
// where everybody means on my channel. A playlist has no link.
export function playlistSharing(choice: Choice): { public: boolean; sharedWith: number[] } {
  return {
    public: choice.audience === "everyone",
    sharedWith: choice.audience === "people" ? choice.people : [],
  };
}

// seenBy says in a few words who sees it, for the lists: "lo vedono
// tutti", "solo tu lo vedi", "lo vede chi ha il link", "lo vedono anche
// Anna e Marco".
export function seenBy(
  isPrivate: boolean,
  sharedWith: { name: string }[],
  link: string | null = null,
): string {
  if (!isPrivate) return "lo vedono tutti";
  if (link !== null) return "lo vede chi ha il link";
  if (sharedWith.length === 0) return "solo tu lo vedi";
  return `lo vedono anche ${namesList(sharedWith.map((p) => p.name))}`;
}

// audienceLabel is the short name of an audience, for the little label on
// my videos.
export const audienceLabel: Record<Audience, string> = {
  everyone: "Pubblico",
  me: "Privato",
  people: "Alcune persone",
  link: "Chi ha il link",
};

// fullLink is the whole address of a link, to paste anywhere.
export function fullLink(link: string): string {
  return new URL(link, window.location.origin).href;
}

// namesList joins names the Italian way: "Anna, Luca e Marco". After four
// names it says how many more.
export function namesList(names: string[]): string {
  const shown =
    names.length > 4 ? [...names.slice(0, 3), `altre ${names.length - 3} persone`] : names;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} e ${shown[shown.length - 1]}`;
}
