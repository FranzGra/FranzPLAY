import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useState } from "react";
import { Link } from "react-router";
import { avatarUrl } from "../../api/auth";
import { maxCommentLength } from "../../api/comments";
import { formatSince } from "../../lib/format";
import { removeSmoothly } from "../../lib/motion";
import styles from "./Comments.module.css";
import { countComments, useComments } from "./useComments";
// Comments is the section under a video where people talk about it:
// conversations newest first, each with its replies.
export function Comments({ videoId }) {
    const { state, add, remove: deleteOne, drop } = useComments(videoId);
    // remove lets the comment fade away while the server deletes it; the
    // ones below then glide up.
    const remove = (id, item) => removeSmoothly(item, () => deleteOne(id), () => drop(id));
    const [now] = useState(() => new Date());
    const titleId = useId();
    const count = state.kind === "ready" ? countComments(state.comments) : 0;
    return (_jsxs("section", { className: styles.root, "aria-labelledby": titleId, children: [_jsx("h2", { id: titleId, className: styles.title, children: count === 0 ? "Commenti" : count === 1 ? "1 commento" : `${count} commenti` }), state.kind === "loading" && _jsx("div", { className: styles.placeholder, "aria-busy": "true" }), state.kind === "error" && (_jsx("p", { className: styles.muted, children: "Non sono riuscito a caricare i commenti. Ricarica la pagina." })), state.kind === "ready" && (_jsxs(_Fragment, { children: [_jsx(CommentForm, { label: "Aggiungi un commento", placeholder: "Aggiungi un commento\u2026", submit: "Commenta", onSubmit: (body) => add(body) }), state.comments.length === 0 ? (_jsx("p", { className: styles.muted, children: "Ancora nessun commento. Scrivi il primo!" })) : (_jsx("ul", { className: `stagger ${styles.list}`, children: state.comments.map((c) => (_jsx("li", { "data-flip": true, children: _jsx(Conversation, { comment: c, now: now, add: add, remove: remove }) }, c.id))) }))] }))] }));
}
// Conversation is a comment with its replies and the form to answer.
function Conversation({ comment, now, add, remove }) {
    const [replying, setReplying] = useState(false);
    const reply = () => setReplying(true);
    return (_jsxs(_Fragment, { children: [_jsx(CommentView, { comment: comment, now: now, onReply: reply, remove: remove }), (comment.replies.length > 0 || replying) && (_jsxs("div", { className: styles.replies, children: [comment.replies.length > 0 && (_jsx("ul", { className: `stagger ${styles.list}`, "aria-label": `Risposte a ${comment.author.name}`, children: comment.replies.map((r) => (_jsx("li", { "data-flip": true, children: _jsx(CommentView, { comment: r, now: now, onReply: reply, remove: remove }) }, r.id))) })), replying && (_jsx(CommentForm, { label: `Rispondi a ${comment.author.name}`, placeholder: "Aggiungi una risposta\u2026", submit: "Rispondi", autoFocus: true, onSubmit: (body) => add(body, comment.id), onDone: () => setReplying(false) }))] }))] }));
}
function CommentView({ comment, now, onReply, remove, }) {
    const [asking, setAsking] = useState(false);
    const [problem, setProblem] = useState("");
    const confirm = (event) => {
        const item = event.currentTarget.closest("li");
        setAsking(false);
        setProblem("");
        remove(comment.id, item).catch((error) => {
            console.error(error);
            setProblem("Non sono riuscito a eliminare il commento. Riprova.");
        });
    };
    return (_jsxs("article", { className: styles.comment, "aria-label": `Commento di ${comment.author.name}`, children: [comment.author.avatar > 0 ? (_jsx("img", { className: styles.avatar, src: avatarUrl(comment.author.id, comment.author.avatar), alt: "", loading: "lazy" })) : (_jsx("span", { className: styles.avatar, "aria-hidden": "true", children: comment.author.name.charAt(0).toUpperCase() })), _jsxs("div", { className: styles.content, children: [_jsxs("p", { className: styles.meta, children: [_jsx(Link, { to: `/canale/${comment.author.id}`, className: styles.author, children: comment.author.name }), _jsx("time", { dateTime: comment.createdAt.toISOString(), children: formatSince(comment.createdAt, now) })] }), _jsx("p", { className: styles.body, children: comment.body }), _jsx("div", { className: styles.actions, children: asking ? (_jsxs(_Fragment, { children: [_jsxs("span", { children: ["Eliminare il commento", comment.replies.length > 0 && " e le sue risposte", "?"] }), _jsx("button", { type: "button", className: `${styles.small} ${styles.danger}`, onClick: confirm, children: "S\u00EC, elimina" }), _jsx("button", { type: "button", className: styles.small, onClick: () => setAsking(false), children: "Annulla" })] })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: styles.small, onClick: onReply, children: "Rispondi" }), comment.canDelete && (_jsx("button", { type: "button", className: styles.small, onClick: () => setAsking(true), children: "Elimina" }))] })) }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] })] }));
}
// CommentForm is where a comment or a reply is written.
function CommentForm({ label, placeholder, submit, autoFocus = false, onSubmit, onDone, }) {
    const [body, setBody] = useState("");
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState("");
    const empty = body.trim() === "";
    const send = (event) => {
        event.preventDefault();
        if (empty || sending)
            return;
        setSending(true);
        setProblem("");
        onSubmit(body)
            .then(() => {
            setBody("");
            onDone?.();
        })
            .catch((error) => {
            console.error(error);
            setProblem("Non sono riuscito a pubblicare il commento. Riprova.");
        })
            .finally(() => setSending(false));
    };
    return (_jsxs("form", { className: styles.form, onSubmit: send, children: [_jsx("textarea", { className: styles.input, "aria-label": label, placeholder: placeholder, value: body, maxLength: maxCommentLength, rows: body.includes("\n") ? 3 : 1, 
                // biome-ignore lint/a11y/noAutofocus: the person just asked to reply here
                autoFocus: autoFocus, onChange: (e) => setBody(e.target.value), onKeyDown: (e) => {
                    // Ctrl+Enter (or Cmd+Enter) sends, like in many chats.
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                        send(e);
                } }), (!empty || onDone) && (_jsxs("div", { className: styles.formActions, children: [_jsx("button", { type: "button", className: styles.small, onClick: () => {
                            setBody("");
                            setProblem("");
                            onDone?.();
                        }, children: "Annulla" }), _jsx("button", { type: "submit", className: styles.send, disabled: empty || sending, children: submit })] })), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem }))] }));
}
