import { useEffect, useState } from "react";
import { fetchServerInfo } from "../../api/health";
// useServerInfo asks the server for its version once, when the page opens.
export function useServerInfo() {
    const [state, setState] = useState({ kind: "loading" });
    useEffect(() => {
        const controller = new AbortController();
        fetchServerInfo(controller.signal)
            .then((info) => setState({ kind: "ready", info }))
            .catch((error) => {
            if (!controller.signal.aborted) {
                console.error(error);
                setState({ kind: "error" });
            }
        });
        return () => controller.abort();
    }, []);
    return state;
}
