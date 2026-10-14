import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHistory, forgetHistory, forgetVideo } from "../../api/progress";
// pageSize is how many videos of the history are asked at a time.
export const pageSize = 24;
// useHistory loads the history a page at a time. loadMore adds the next
// page. forget tells the server to remove one video and drop takes it off
// the page; clear and empty do the same for the whole history. They are
// apart so the page can let a video fade away while the server answers.
// forget and clear throw if the server refuses, so the page can say so.
export function useHistory() {
    const [state, setState] = useState({ kind: "loading" });
    const controller = useRef(null);
    useEffect(() => {
        const c = new AbortController();
        controller.current = c;
        fetchHistory({ limit: pageSize }, c.signal)
            .then(({ items, total }) => setState({ kind: "ready", items, total, more: "idle" }))
            .catch((error) => {
            if (!c.signal.aborted) {
                console.error(error);
                setState({ kind: "error" });
            }
        });
        return () => c.abort();
    }, []);
    const loadMore = useCallback(() => {
        if (state.kind !== "ready" || state.more === "loading")
            return;
        const signal = controller.current?.signal;
        setState({ ...state, more: "loading" });
        fetchHistory({ limit: pageSize, offset: state.items.length }, signal)
            .then(({ items, total }) => setState((current) => current.kind === "ready"
            ? { kind: "ready", items: [...current.items, ...items], total, more: "idle" }
            : current))
            .catch((error) => {
            if (!signal?.aborted) {
                console.error(error);
                setState((current) => current.kind === "ready" ? { ...current, more: "error" } : current);
            }
        });
    }, [state]);
    const forget = useCallback((id) => forgetVideo(id), []);
    const drop = useCallback((id) => {
        setState((current) => current.kind === "ready"
            ? {
                ...current,
                items: current.items.filter((w) => w.video.id !== id),
                total: Math.max(0, current.total - 1),
            }
            : current);
    }, []);
    const clear = useCallback(() => forgetHistory(), []);
    const empty = useCallback(() => {
        setState({ kind: "ready", items: [], total: 0, more: "idle" });
    }, []);
    return { state, loadMore, forget, drop, clear, empty };
}
