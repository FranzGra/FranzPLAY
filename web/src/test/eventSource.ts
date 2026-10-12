// FakeEventSource stands in for the browser's EventSource in tests:
// stubEventSource installs it, emit plays a message from the server.
export class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly url: string;
  closed = false;
  private handlers = new Map<string, Array<() => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }

  addEventListener(kind: string, handler: () => void) {
    this.handlers.set(kind, [...(this.handlers.get(kind) ?? []), handler]);
  }

  close() {
    this.closed = true;
  }

  emit(kind: string) {
    for (const h of this.handlers.get(kind) ?? []) h();
  }
}

export function stubEventSource() {
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
}
