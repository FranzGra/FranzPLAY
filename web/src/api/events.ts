// Live changes from the server (Server-Sent Events). The server only says
// what changed; each page asks again for what it shows.
//
// On plain HTTP/1.1 a browser opens at most six connections to a server,
// shared by all its tabs, and an EventSource keeps one busy for as long as
// it is open: with six tabs of FranzPLAY open, every other request of every
// tab waited forever. So the tabs share one connection:
//   - where the browser has SharedWorker, one worker for all the tabs holds
//     the only EventSource and passes its events on (see eventsHub.ts);
//   - elsewhere each tab holds its own, but closes it while the tab is
//     hidden. When the tab shows again, every listener hears that its kind
//     changed, since nobody told it while it was away.

import { type EventKind, eventKinds, isEventKind } from "./eventsHub";

export type { EventKind };

type Listener = () => void;
const listeners = new Map<EventKind, Set<Listener>>();

// connection is how this tab hears the server, while someone listens.
type Connection = { close(): void };
let connection: Connection | null = null;

// sharedFailed is set when the shared worker could not start: from then on
// this tab connects by itself.
let sharedFailed = false;

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
  connection ??= connect();
  return () => {
    set.delete(listener);
    if ([...listeners.values()].every((s) => s.size === 0)) {
      connection?.close();
      connection = null;
    }
  };
}

function tell(kind: EventKind) {
  for (const listener of listeners.get(kind) ?? []) listener();
}

function connect(): Connection | null {
  if (!sharedFailed && typeof SharedWorker !== "undefined") {
    const shared = connectShared();
    if (shared) return shared;
  }
  // Old browsers and tests may have no EventSource: pages still work,
  // they just do not update by themselves.
  if (typeof EventSource === "undefined") return null;
  return connectOwn();
}

// connectShared joins the worker that holds the one connection of all tabs.
function connectShared(): Connection | null {
  let worker: SharedWorker;
  try {
    worker = new SharedWorker(new URL("./eventsWorker.ts", import.meta.url), {
      type: "module",
      name: "franzplay-events",
    });
  } catch {
    sharedFailed = true;
    return null;
  }
  const port = worker.port;
  let closed = false;
  const own: { current: Connection | null } = { current: null };
  port.onmessage = (event: MessageEvent) => {
    if (isEventKind(event.data)) tell(event.data);
  };
  // The worker did not start (blocked, or its file is missing): this tab
  // connects by itself, as if there were no shared worker.
  worker.onerror = () => {
    sharedFailed = true;
    if (!closed && !own.current && typeof EventSource !== "undefined") own.current = connectOwn();
  };
  port.start();
  port.postMessage("listen");
  return {
    close() {
      closed = true;
      port.postMessage("stop");
      port.close();
      own.current?.close();
    },
  };
}

// connectOwn holds a connection for this tab alone, open only while the tab
// can be seen.
function connectOwn(): Connection {
  let source: EventSource | null = null;
  const open = () => {
    source = new EventSource("/api/events");
    for (const kind of eventKinds) source.addEventListener(kind, () => tell(kind));
  };
  const onVisibility = () => {
    if (document.hidden) {
      source?.close();
      source = null;
    } else if (!source) {
      open();
      for (const kind of eventKinds) tell(kind);
    }
  };
  if (!document.hidden) open();
  document.addEventListener("visibilitychange", onVisibility);
  return {
    close() {
      document.removeEventListener("visibilitychange", onVisibility);
      source?.close();
      source = null;
    },
  };
}
