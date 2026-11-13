// The shared worker of the server's events: one for all the tabs of the
// browser, so they share one connection. See events.ts and eventsHub.ts.

import { type HubScope, serveEvents } from "./eventsHub";

serveEvents(self as unknown as HubScope);
