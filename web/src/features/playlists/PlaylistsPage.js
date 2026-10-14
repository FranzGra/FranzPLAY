import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router";
import { createPlaylist, fetchPlaylists } from "../../api/playlists";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { NameForm } from "./NameForm";
import { Pile, PlaylistCard } from "./PlaylistCard";
import styles from "./Playlists.module.css";
// PlaylistsPage shows my lists: "Guarda più tardi" first, then the
// videos I like, then the lists I made, and lets me make a new one.
export function PlaylistsPage() {
    usePageTitle("Playlist");
    const [state, setState] = useState({ kind: "loading" });
    const [making, setMaking] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        fetchPlaylists(undefined, controller.signal)
            .then((lists) => setState({ kind: "ready", lists }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, []);
    const make = async (name) => {
        const list = await createPlaylist(name);
        setState((s) => {
            if (s.kind !== "ready")
                return s;
            const [later, ...mine] = s.lists;
            return { kind: "ready", lists: later ? [later, list, ...mine] : [list] };
        });
        setMaking(false);
    };
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.top, children: [_jsxs("h1", { className: styles.heading, children: [_jsx(Icon, { name: "playlist", size: 26 }), "Playlist"] }), state.kind === "ready" && !making && (_jsxs("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setMaking(true), children: [_jsx(Icon, { name: "plus", size: 18 }), "Nuova playlist"] }))] }), making && (_jsx(NameForm, { submit: "Crea", failure: "Non sono riuscito a creare la playlist. Riprova.", onSubmit: make, onCancel: () => setMaking(false) })), state.kind === "loading" && _jsx("div", { className: styles.placeholder, "aria-busy": "true" }), state.kind === "error" && (_jsx(EmptyState, { title: "Playlist non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." })), state.kind === "ready" && (_jsx("ul", { className: `stagger ${styles.grid}`, children: state.lists.map((list) => (_jsxs(Fragment, { children: [_jsx("li", { children: _jsx(PlaylistCard, { list: list, markPublic: true }) }), list.kind === "later" && (_jsxs(_Fragment, { children: [_jsx(LikedCard, {}), _jsx(SharedCard, {})] }))] }, list.id))) })), state.kind === "ready" && state.lists.length === 1 && !making && (_jsxs("p", { className: styles.hint, children: ["Per fare una playlist premi ", _jsx("strong", { children: "Nuova playlist" }), ", oppure ", _jsx("strong", { children: "Salva" }), " ", "sotto un video."] }))] }));
}
// LikedCard leads to the videos I like: on phones this page is the way
// there, since the bottom bar has only a few tabs.
function LikedCard() {
    return (_jsx("li", { children: _jsxs(Link, { to: "/mi-piace", className: `glow ${styles.card}`, children: [_jsx(Pile, {}), _jsx("span", { className: styles.cover, children: _jsx("span", { className: styles.noCover, children: _jsx(Icon, { name: "like", size: 32 }) }) }), _jsx("span", { className: styles.cardName, children: "Mi piace" }), _jsx("span", { className: styles.cardCount, children: "I video che ti piacciono" })] }) }));
}
// SharedCard leads to what others shared only with some people, me among
// them: on phones too, from here.
function SharedCard() {
    return (_jsx("li", { children: _jsxs(Link, { to: "/condivisi", className: `glow ${styles.card}`, children: [_jsx(Pile, {}), _jsx("span", { className: styles.cover, children: _jsx("span", { className: styles.noCover, children: _jsx(Icon, { name: "share", size: 32 }) }) }), _jsx("span", { className: styles.cardName, children: "Condivisi con te" }), _jsx("span", { className: styles.cardCount, children: "Solo per te e pochi altri" })] }) }));
}
