// Who sees something private: everybody, only me, or the people I choose.
// choiceOf reads the choice of something from the server's answer.
export function choiceOf(isPrivate, sharedWith) {
    if (!isPrivate)
        return { audience: "everyone", people: [] };
    if (sharedWith.length === 0)
        return { audience: "me", people: [] };
    return { audience: "people", people: sharedWith.map((p) => p.id) };
}
// sharing is the choice as the server takes it.
export function sharing(choice) {
    return {
        private: choice.audience !== "everyone",
        sharedWith: choice.audience === "people" ? choice.people : [],
    };
}
// ready says whether the choice can be saved: "people" needs someone.
export function ready(choice) {
    return choice.audience !== "people" || choice.people.length > 0;
}
// playlistSharing is the choice as the server takes it for a playlist,
// where everybody means on my channel.
export function playlistSharing(choice) {
    const { private: hidden, sharedWith } = sharing(choice);
    return { public: !hidden, sharedWith };
}
// seenBy says in a few words who sees it, for the lists: "lo vedono
// tutti", "solo tu lo vedi", "lo vedono anche Anna e Marco".
export function seenBy(isPrivate, sharedWith) {
    if (!isPrivate)
        return "lo vedono tutti";
    if (sharedWith.length === 0)
        return "solo tu lo vedi";
    return `lo vedono anche ${namesList(sharedWith.map((p) => p.name))}`;
}
// namesList joins names the Italian way: "Anna, Luca e Marco". After four
// names it says how many more.
export function namesList(names) {
    const shown = names.length > 4 ? [...names.slice(0, 3), `altre ${names.length - 3} persone`] : names;
    if (shown.length <= 1)
        return shown.join("");
    return `${shown.slice(0, -1).join(", ")} e ${shown[shown.length - 1]}`;
}
