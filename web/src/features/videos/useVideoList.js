import { useCallback, useEffect, useRef, useState } from "react";
import { onServerEvent } from "../../api/events";
import { fetchVideos } from "../../api/videos";
// pageSize is how many videos are asked at a time: enough to fill a big
// screen, few enough to answer fast on a Raspberry Pi.
export const pageSize = 24;
// maxShown is the most videos asked again at once after a change: the
// server's own limit for one page.
const maxShown = 200;
// useVideoList loads the videos matching filter a page at a time.
export function useVideoList({ category = "", uploader, q = "", seed } = {}) {
    const load = useCallback((page, signal) => fetchVideos({ category, uploader, q, seed, ...page }, signal), [category, uploader, q, seed]);
    return usePagedVideos(load);
}
// usePagedVideos loads a list of videos a page at a time; load must stay
// the same between renders (useCallback), or the list starts again.
// loadMore adds the next page. When the server says the library changed,
// the videos shown are asked again quietly, so new ones appear by
// themselves and covers fill in as they are made.
export function usePagedVideos(load) {
    const [state, setState] = useState({ kind: "loading" });
    const controller = useRef(null);
    const shown = useRef(pageSize);
    useEffect(() => {
        const c = new AbortController();
        controller.current = c;
        shown.current = pageSize;
        setState({ kind: "loading" });
        load({ limit: pageSize }, c.signal)
            .then(({ videos, total }) => setState({ kind: "ready", videos, total, more: "idle" }))
            .catch((error) => {
            if (!c.signal.aborted) {
                console.error(error);
                setState({ kind: "error" });
            }
        });
        const refresh = () => {
            load({ limit: shown.current }, c.signal)
                .then(({ videos, total }) => setState((current) => current.kind === "ready" && current.more === "loading"
                ? current // a page is arriving: the next change will catch up
                : { kind: "ready", videos, total, more: "idle" }))
                .catch((error) => {
                // The list on screen stays as it was.
                if (!c.signal.aborted)
                    console.error(error);
            });
        };
        const stop = onServerEvent("library", refresh);
        return () => {
            stop();
            c.abort();
        };
    }, [load]);
    const loadMore = useCallback(() => {
        if (state.kind !== "ready" || state.more === "loading") {
            return;
        }
        const signal = controller.current?.signal;
        const offset = state.videos.length;
        shown.current = Math.min(offset + pageSize, maxShown);
        setState({ ...state, more: "loading" });
        load({ limit: pageSize, offset }, signal)
            .then(({ videos, total }) => setState((current) => current.kind === "ready"
            ? { kind: "ready", videos: [...current.videos, ...videos], total, more: "idle" }
            : current))
            .catch((error) => {
            if (!signal?.aborted) {
                console.error(error);
                setState((current) => current.kind === "ready" ? { ...current, more: "error" } : current);
            }
        });
    }, [load, state]);
    return { state, loadMore };
}
