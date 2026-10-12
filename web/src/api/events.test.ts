import { FakeEventSource, stubEventSource } from "../test/eventSource";
import { onServerEvent } from "./events";

describe("onServerEvent", () => {
  beforeEach(() => {
    stubEventSource();
  });

  it("opens one connection for every listener and closes it with the last", () => {
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

  it("does nothing where the browser has no EventSource", () => {
    vi.stubGlobal("EventSource", undefined);
    const stop = onServerEvent("library", vi.fn());
    expect(FakeEventSource.last).toBeNull();
    stop();
  });
});
