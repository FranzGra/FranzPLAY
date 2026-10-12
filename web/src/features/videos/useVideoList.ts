import { useCallback, useEffect, useRef, useState } from "react";
import { onServerEvent } from "../../api/events";
import { fetchVideos, type Video } from "../../api/videos";

// pageSize is how many videos are asked at a time: enough to fill a big
// screen, few enough to answer fast on a Raspberry Pi.
export const pageSize = 24;

// maxShown is the most videos asked again at once after a change: the
// server's own limit for one page.
const maxShown = 200;

export type VideoListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; videos: Video[]; total: number; more: "idle" | "loading" | "error" };

// Filter chooses which videos: of one category, matching a search, or all.
export type Filter = { category?: string; q?: string };

// useVideoList loads the newest videos matching filter a page at a time.
// loadMore adds the next page. When the server says the library changed,
// the videos shown are asked again quietly, so new ones appear by
// themselves and covers fill in as they are made.
export function useVideoList({ category = "", q = "" }: Filter = {}) {
  const [state, setState] = useState<VideoListState>({ kind: "loading" });
  const controller = useRef<AbortController | null>(null);
  const shown = useRef(pageSize);

  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    shown.current = pageSize;
    setState({ kind: "loading" });
    fetchVideos({ category, q, limit: pageSize }, c.signal)
      .then(({ videos, total }) => setState({ kind: "ready", videos, total, more: "idle" }))
      .catch((error: unknown) => {
        if (!c.signal.aborted) {
          console.error(error);
          setState({ kind: "error" });
        }
      });

    const refresh = () => {
      fetchVideos({ category, q, limit: shown.current }, c.signal)
        .then(({ videos, total }) =>
          setState((current) =>
            current.kind === "ready" && current.more === "loading"
              ? current // a page is arriving: the next change will catch up
              : { kind: "ready", videos, total, more: "idle" },
          ),
        )
        .catch((error: unknown) => {
          // The list on screen stays as it was.
          if (!c.signal.aborted) console.error(error);
        });
    };
    const stop = onServerEvent("library", refresh);
    return () => {
      stop();
      c.abort();
    };
  }, [category, q]);

  const loadMore = useCallback(() => {
    if (state.kind !== "ready" || state.more === "loading") {
      return;
    }
    const signal = controller.current?.signal;
    const offset = state.videos.length;
    shown.current = Math.min(offset + pageSize, maxShown);
    setState({ ...state, more: "loading" });
    fetchVideos({ category, q, limit: pageSize, offset }, signal)
      .then(({ videos, total }) =>
        setState((current) =>
          current.kind === "ready"
            ? { kind: "ready", videos: [...current.videos, ...videos], total, more: "idle" }
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
  }, [category, q, state]);

  return { state, loadMore };
}
