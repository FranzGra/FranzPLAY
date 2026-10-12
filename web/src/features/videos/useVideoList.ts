import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVideos, type Video } from "../../api/videos";

// pageSize is how many videos are asked at a time: enough to fill a big
// screen, few enough to answer fast on a Raspberry Pi.
export const pageSize = 24;

export type VideoListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; videos: Video[]; total: number; more: "idle" | "loading" | "error" };

// Filter chooses which videos: of one category, matching a search, or all.
export type Filter = { category?: string; q?: string };

// useVideoList loads the newest videos matching filter a page at a time.
// loadMore adds the next page.
export function useVideoList({ category = "", q = "" }: Filter = {}) {
  const [state, setState] = useState<VideoListState>({ kind: "loading" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    setState({ kind: "loading" });
    fetchVideos({ category, q, limit: pageSize }, c.signal)
      .then(({ videos, total }) => setState({ kind: "ready", videos, total, more: "idle" }))
      .catch((error: unknown) => {
        if (!c.signal.aborted) {
          console.error(error);
          setState({ kind: "error" });
        }
      });
    return () => c.abort();
  }, [category, q]);

  const loadMore = useCallback(() => {
    if (state.kind !== "ready" || state.more === "loading") {
      return;
    }
    const signal = controller.current?.signal;
    const offset = state.videos.length;
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
