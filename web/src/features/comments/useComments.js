import { useCallback, useEffect, useState } from "react";
import { addComment, deleteComment, fetchComments } from "../../api/comments";
// useComments loads the conversations under a video and keeps them up to
// date when I write or delete one. add and remove fail like the server
// does, so the form can say so.
export function useComments(videoId) {
    const [state, setState] = useState({ kind: "loading" });
    useEffect(() => {
        const controller = new AbortController();
        setState({ kind: "loading" });
        fetchComments(videoId, controller.signal)
            .then((comments) => setState({ kind: "ready", comments }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, [videoId]);
    const change = useCallback((edit) => {
        setState((s) => (s.kind === "ready" ? { kind: "ready", comments: edit(s.comments) } : s));
    }, []);
    // add writes a comment, or answers the conversation rootId.
    const add = useCallback(async (body, rootId) => {
        const written = await addComment(videoId, body, rootId);
        change((comments) => rootId === undefined
            ? [written, ...comments]
            : comments.map((c) => (c.id === rootId ? { ...c, replies: [...c.replies, written] } : c)));
    }, [videoId, change]);
    // remove deletes a comment on the server; drop then takes it off the
    // page. They are apart so the page can let it fade away meanwhile.
    const remove = useCallback((id) => deleteComment(id), []);
    const drop = useCallback((id) => change((comments) => comments
        .filter((c) => c.id !== id)
        .map((c) => ({ ...c, replies: c.replies.filter((r) => r.id !== id) }))), [change]);
    return { state, add, remove, drop };
}
// countComments counts conversations and replies together.
export function countComments(comments) {
    return comments.reduce((n, c) => n + 1 + c.replies.length, 0);
}
