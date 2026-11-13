import { FakeEventSource, stubEventSource } from "../test/eventSource";
import { type HubScope, serveEvents } from "./eventsHub";

// events.ts remembers its connection and whether the shared worker failed:
// every test loads it afresh.
async function load() {
  vi.resetModules();
  return (await import("./events")).onServerEvent;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

// FakePort stands in for one end of a MessagePort.
class FakePort {
  sent: unknown[] = [];
  started = false;
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage(data: unknown) {
    this.sent.push(data);
  }
  start() {
    this.started = true;
  }
  close() {
    this.closed = true;
  }
  receive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

// FakeSharedWorker stands in for the browser's SharedWorker.
class FakeSharedWorker {
  static all: FakeSharedWorker[] = [];
  readonly port = new FakePort();
  onerror: (() => void) | null = null;
  constructor() {
    FakeSharedWorker.all.push(this);
  }
}

describe("onServerEvent", () => {
  beforeEach(() => {
    stubEventSource();
    setHidden(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens one connection for every listener and closes it with the last", async () => {
    const onServerEvent = await load();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = onServerEvent("library", a);
    const first = FakeEventSource.last;
    const stopB = onServerEvent("library", b);
    expect(FakeEventSource.last).toBe(first);
    expect(first?.url).toBe("/api/events");

    first?.emit("library");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    stopA();
    first?.emit("library");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(first?.closed).toBe(false);

    stopB();
    expect(first?.closed).toBe(true);
  });

  it("lets the connection go while the tab is hidden, and catches up when it shows", async () => {
    const onServerEvent = await load();
    const library = vi.fn();
    const jobs = vi.fn();
    const stopLibrary = onServerEvent("library", library);
    const stopJobs = onServerEvent("jobs", jobs);
    const first = FakeEventSource.last;

    setHidden(true);
    expect(first?.closed).toBe(true);
    expect(library).not.toHaveBeenCalled();

    setHidden(false);
    const second = FakeEventSource.last;
    expect(second).not.toBe(first);
    expect(second?.closed).toBe(false);
    // Nobody said what changed while the tab was away: everyone asks again.
    expect(library).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveBeenCalledTimes(1);

    second?.emit("jobs");
    expect(jobs).toHaveBeenCalledTimes(2);

    stopLibrary();
    stopJobs();
    expect(second?.closed).toBe(true);
    // Once nobody listens, coming back opens nothing.
    setHidden(true);
    setHidden(false);
    expect(FakeEventSource.last).toBe(second);
  });

  it("does not connect from a tab opened hidden until it shows", async () => {
    const onServerEvent = await load();
    setHidden(true);
    const stop = onServerEvent("scan", vi.fn());
    expect(FakeEventSource.last).toBeNull();
    setHidden(false);
    expect(FakeEventSource.last?.closed).toBe(false);
    stop();
  });

  it("shares one connection through the shared worker", async () => {
    FakeSharedWorker.all = [];
    vi.stubGlobal("SharedWorker", FakeSharedWorker);
    const onServerEvent = await load();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = onServerEvent("library", a);
    const stopB = onServerEvent("jobs", b);

    expect(FakeSharedWorker.all).toHaveLength(1);
    expect(FakeEventSource.last).toBeNull();
    const port = FakeSharedWorker.all[0]?.port;
    expect(port?.started).toBe(true);
    expect(port?.sent).toEqual(["listen"]);

    port?.receive("library");
    port?.receive("nonsense");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    stopA();
    stopB();
    expect(port?.sent).toEqual(["listen", "stop"]);
    expect(port?.closed).toBe(true);
  });

  it("connects by itself when the shared worker does not start", async () => {
    FakeSharedWorker.all = [];
    vi.stubGlobal("SharedWorker", FakeSharedWorker);
    const onServerEvent = await load();
    const a = vi.fn();
    const stop = onServerEvent("library", a);
    FakeSharedWorker.all[0]?.onerror?.();

    const own = FakeEventSource.last;
    expect(own?.url).toBe("/api/events");
    own?.emit("library");
    expect(a).toHaveBeenCalledTimes(1);
    stop();
    expect(own?.closed).toBe(true);

    // Later listeners do not try the worker again.
    const again = onServerEvent("library", vi.fn());
    expect(FakeSharedWorker.all).toHaveLength(1);
    again();
  });

  it("does nothing where the browser has no EventSource", async () => {
    const onServerEvent = await load();
    vi.stubGlobal("EventSource", undefined);
    const stop = onServerEvent("library", vi.fn());
    expect(FakeEventSource.last).toBeNull();
    stop();
  });
});

describe("serveEvents", () => {
  beforeEach(() => {
    stubEventSource();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("holds one connection for every tab and passes each event to all", () => {
    const scope: HubScope = { onconnect: null };
    serveEvents(scope);
    const tab1 = new FakePort();
    const tab2 = new FakePort();
    scope.onconnect?.({ ports: [tab1] } as unknown as MessageEvent);
    scope.onconnect?.({ ports: [tab2] } as unknown as MessageEvent);
    expect(tab1.started && tab2.started).toBe(true);
    expect(FakeEventSource.last).toBeNull();

    tab1.receive("listen");
    const source = FakeEventSource.last;
    tab2.receive("listen");
    expect(FakeEventSource.last).toBe(source);
    expect(source?.url).toBe("/api/events");

    source?.emit("scan");
    expect(tab1.sent).toEqual(["scan"]);
    expect(tab2.sent).toEqual(["scan"]);

    tab1.receive("stop");
    source?.emit("jobs");
    expect(tab1.sent).toEqual(["scan"]);
    expect(tab2.sent).toEqual(["scan", "jobs"]);
    expect(source?.closed).toBe(false);

    tab2.receive("stop");
    expect(source?.closed).toBe(true);

    // A tab that listens again opens a new one.
    tab1.receive("listen");
    expect(FakeEventSource.last).not.toBe(source);
  });
});
