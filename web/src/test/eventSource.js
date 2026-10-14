// FakeEventSource stands in for the browser's EventSource in tests:
// stubEventSource installs it, emit plays a message from the server.
export class FakeEventSource {
    static last = null;
    url;
    closed = false;
    handlers = new Map();
    constructor(url) {
        this.url = url;
        FakeEventSource.last = this;
    }
    addEventListener(kind, handler) {
        this.handlers.set(kind, [...(this.handlers.get(kind) ?? []), handler]);
    }
    close() {
        this.closed = true;
    }
    emit(kind) {
        for (const h of this.handlers.get(kind) ?? [])
            h();
    }
}
export function stubEventSource() {
    FakeEventSource.last = null;
    vi.stubGlobal("EventSource", FakeEventSource);
}
