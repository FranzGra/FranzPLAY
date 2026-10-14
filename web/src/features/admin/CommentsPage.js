import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { deleteComment, fetchRecentComments } from "../../api/comments";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatSince } from "../../lib/format";
import styles from "./Admin.module.css";
const pageSize = 50;
const maxShown = 200;
// CommentsPage lists every comment, the newest first, so the
// administrator can keep FranzPLAY a pleasant place and delete what does
// not belong.
export function CommentsPage() {
    const [state, setState] = useState({ kind: "loading" });
    const shown = useRef(pageSize);
    const load = useCallback((limit, signal) => {
        fetchRecentComments(limit, signal)
            .then(({ comments, total }) => setState({ kind: "ready", comments, total }))
            .catch((error) => {
            if (signal?.aborted)
                return;
            console.error(error);
            setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
        });
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        load(pageSize, controller.signal);
        return () => controller.abort();
    }, [load]);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Commenti non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    if (state.comments.length === 0) {
        return (_jsx(EmptyState, { title: "Ancora nessun commento", children: "Quando qualcuno scrive sotto un video, il commento compare qui." }));
    }
    const removed = (c) => {
        setState((s) => s.kind === "ready" ? { ...s, comments: s.comments.filter((x) => x.id !== c.id) } : s);
        // Its replies went with it: ask again for the list as it is now.
        load(shown.current);
    };
    const more = () => {
        shown.current = Math.min(shown.current + pageSize, maxShown);
        load(shown.current);
    };
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: styles.lead, children: "Tutti i commenti, dai pi\u00F9 nuovi. Puoi eliminare quelli che non vanno bene: chi li ha scritti non riceve avvisi." }), _jsxs("p", { className: styles.count, children: [state.total.toLocaleString("it-IT"), " ", state.total === 1 ? "commento" : "commenti"] }), _jsx("ul", { className: `stagger ${styles.list}`, "aria-label": "Commenti", children: state.comments.map((c) => (_jsx("li", { children: _jsx(CommentRow, { comment: c, onRemoved: () => removed(c) }) }, c.id))) }), state.comments.length < state.total && state.comments.length < maxShown && (_jsx("button", { type: "button", className: `glass ${styles.action} ${styles.more}`, onClick: more, children: "Mostra altri" }))] }));
}
function CommentRow({ comment, onRemoved }) {
    const [asking, setAsking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState("");
    const remove = () => {
        setBusy(true);
        setProblem("");
        deleteComment(comment.id)
            .then(onRemoved)
            .catch((error) => {
            console.error(error);
            setProblem("Non sono riuscito a eliminarlo. Riprova tra poco.");
            setBusy(false);
        });
    };
    return (_jsxs("div", { className: `glass ${styles.person}`, children: [_jsxs("div", { className: styles.failed, children: [_jsxs("p", { className: styles.role, children: [_jsx("strong", { className: styles.author, children: comment.author.name }), comment.reply ? " ha risposto sotto " : " ha scritto sotto ", comment.video.visible ? (_jsx(Link, { to: `/video/${comment.video.id}`, children: comment.video.title })) : (_jsxs("span", { children: [comment.video.title, " (nascosto o non trovato)"] })), " ", "\u00B7 ", formatSince(comment.createdAt, new Date())] }), _jsx("p", { className: styles.body, children: comment.body }), asking && (_jsxs("div", { className: styles.confirm, children: [_jsxs("p", { children: ["Eliminare questo commento?", comment.replies > 0 &&
                                        ` Spariscono anche ${comment.replies === 1 ? "la sua risposta" : `le sue ${comment.replies} risposte`}.`] }), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setAsking(false), children: "Annulla" }), _jsx("button", { type: "button", className: `${styles.action} ${styles.danger}`, disabled: busy, onClick: remove, children: "S\u00EC, elimina" })] })] })), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }), !asking && (_jsxs("button", { type: "button", className: `glass ${styles.action} ${styles.danger}`, onClick: () => setAsking(true), children: [_jsx(Icon, { name: "trash", size: 16 }), "Elimina"] }))] }));
}
