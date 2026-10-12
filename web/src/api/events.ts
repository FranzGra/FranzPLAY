// Live changes from the server (Server-Sent Events). The server only says
// what changed; each page asks again for what it shows.

export type EventKind = "library" | "jobs";

const kinds: readonly EventKind[] = ["library", "jobs"];

type Listener = () => void;
const listeners = new Map<EventKind, Set<Listener>>();
let source: EventSource | null = null;

// onServerEvent calls listener every time the server says kind changed.
// The connection opens with the first listener and closes with the last.
// It returns a function that stops listening.
export function onServerEvent(kind: EventKind, listener: Listener): () => void {
  let set = listeners.get(kind);
  if (!set) {
    set = new Set();
    listeners.set(kind, set);
  }
  set.add(listener);
  connect();
  return () => {
    set.delete(listener);
    if ([...listeners.values()].every((s) => s.size === 0)) {
      source?.close();
      source = null;
    }
  };
}

function connect() {
  // Old browsers and tests may have no EventSource: pages still work,
  // they just do not update by themselves.
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  for (const kind of kinds) {
    source.addEventListener(kind, () => {
      for (const listener of listeners.get(kind) ?? []) listener();
    });
  }
}
