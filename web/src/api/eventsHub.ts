// The hub that holds the one connection to the server's events for every
// tab of the browser. It runs in a shared worker (eventsWorker.ts); it
// lives in its own file so it can be tested without one.

export type EventKind = "library" | "jobs" | "scan";

export const eventKinds: readonly EventKind[] = ["library", "jobs", "scan"];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (eventKinds as readonly string[]).includes(value);
}

// HubScope is what the hub needs of the shared worker: a call for every
// tab that joins.
export type HubScope = { onconnect: ((event: MessageEvent) => void) | null };

// serveEvents makes scope a hub. Each tab joins with a port and says
// "listen" or "stop". The connection opens with the first tab that listens
// and closes with the last that stops; every event goes to every tab
// listening. A tab closed without saying "stop" keeps the connection open
// at most until the browser ends the worker, when no tab is left.
export function serveEvents(scope: HubScope) {
  const tabs = new Set<MessagePort>();
  let source: EventSource | null = null;

  const open = () => {
    if (source) return;
    source = new EventSource("/api/events");
    for (const kind of eventKinds) {
      source.addEventListener(kind, () => {
        for (const tab of tabs) tab.postMessage(kind);
      });
    }
  };

  scope.onconnect = (event: MessageEvent) => {
    const tab = event.ports[0];
    if (!tab) return;
    tab.onmessage = (message: MessageEvent) => {
      if (message.data === "listen") {
        tabs.add(tab);
        open();
      } else if (message.data === "stop") {
        tabs.delete(tab);
        if (tabs.size === 0) {
          source?.close();
          source = null;
        }
      }
    };
    tab.start();
  };
}
