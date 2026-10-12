import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHistory, forgetHistory, forgetVideo, type Watched } from "../../api/progress";

// pageSize is how many videos of the history are asked at a time.
export const pageSize = 24;

export type HistoryState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: Watched[]; total: number; more: "idle" | "loading" | "error" };

// useHistory loads the history a page at a time. loadMore adds the next
// page; forget removes one video; clear empties it. forget and clear
// throw if the server refuses, so the page can say so.
export function useHistory() {
  const [state, setState] = useState<HistoryState>({ kind: "loading" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    fetchHistory({ limit: pageSize }, c.signal)
      .then(({ items, total }) => setState({ kind: "ready", items, total, more: "idle" }))
      .catch((error: unknown) => {
        if (!c.signal.aborted) {
          console.error(error);
          setState({ kind: "error" });
        }
      });
    return () => c.abort();
  }, []);

  const loadMore = useCallback(() => {
    if (state.kind !== "ready" || state.more === "loading") return;
    const signal = controller.current?.signal;
    setState({ ...state, more: "loading" });
    fetchHistory({ limit: pageSize, offset: state.items.length }, signal)
      .then(({ items, total }) =>
        setState((current) =>
          current.kind === "ready"
            ? { kind: "ready", items: [...current.items, ...items], total, more: "idle" }
            : current,
        ),
      )
      .catch((error: unknown) => {
        if (!signal?.aborted) {
          console.error(error);
          setState((current) =>
            current.kind === "ready" ? { ...current, more: "error" } : current,
          );
        }
      });
  }, [state]);

  const forget = useCallback(async (id: number) => {
    await forgetVideo(id);
    setState((current) =>
      current.kind === "ready"
        ? {
            ...current,
            items: current.items.filter((w) => w.video.id !== id),
            total: Math.max(0, current.total - 1),
          }
        : current,
    );
  }, []);

  const clear = useCallback(async () => {
    await forgetHistory();
    setState({ kind: "ready", items: [], total: 0, more: "idle" });
  }, []);

  return { state, loadMore, forget, clear };
}
