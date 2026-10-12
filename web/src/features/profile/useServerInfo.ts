import { useEffect, useState } from "react";
import { fetchServerInfo, type ServerInfo } from "../../api/health";

export type ServerInfoState =
  | { kind: "loading" }
  | { kind: "ready"; info: ServerInfo }
  | { kind: "error" };

// useServerInfo asks the server for its version once, when the page opens.
export function useServerInfo(): ServerInfoState {
  const [state, setState] = useState<ServerInfoState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchServerInfo(controller.signal)
      .then((info) => setState({ kind: "ready", info }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setState({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, []);

  return state;
}
