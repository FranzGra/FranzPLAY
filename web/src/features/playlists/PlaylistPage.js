import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../../api/client";
import { deletePlaylist, fetchPlaylist, playlistName, putInPlaylist, renamePlaylist, sharePlaylist, } from "../../api/playlists";
import { useAccount } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatVideos } from "../../lib/format";
import { removeSmoothly } from "../../lib/motion";
import { choiceOf, namesList, playlistSharing, ready } from "../sharing/audience";
import { WhoSees } from "../sharing/WhoSees";
import { RemovableCard } from "../videos/RemovableCard";
import { VideoCard } from "../videos/VideoCard";
import { NameForm } from "./NameForm";
import styles from "./Playlists.module.css";
// PlaylistPage shows a list with its videos, in order. On one of my
// lists any video can be taken out, and an ordinary list can be renamed,
// deleted, shown on my channel or shared with some people. Someone else's
// list, public or shared with me, can only be watched.
export function PlaylistPage() {
    const account = useAccount();
    const param = useParams().id ?? "";
    const id = /^\d+$/.test(param) ? Number(param) : 0;
    const navigate = useNavigate();
    const [state, setState] = useState({ kind: "loading" });
    const [now] = useState(() => new Date());
    const [mode, setMode] = useState("view");
    const [who, setWho] = useState({ audience: "me", people: [] });
    const [problem, setProblem] = useState("");
    usePageTitle(state.kind === "ready"
        ? playlistName(state.playlist)
        : state.kind === "missing"
            ? "Playlist non trovata"
            : "");
    useEffect(() => {
        if (id <= 0) {
            setState({ kind: "missing" });
            return;
        }
        const controller = new AbortController();
        setState({ kind: "loading" });
        fetchPlaylist(id, controller.signal)
            .then((page) => setState({ kind: "ready", ...page }))
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            if (error instanceof ApiError && error.status === 404) {
                setState({ kind: "missing" });
                return;
            }
            console.error(error);
            setState({ kind: "error" });
        });
        return () => controller.abort();
    }, [id]);
    if (state.kind === "loading")
        return _jsx("div", { className: styles.placeholder, "aria-busy": "true" });
    if (state.kind === "missing") {
        return (_jsxs(EmptyState, { title: "Playlist non trovata", headingLevel: 1, children: ["Questa playlist non esiste pi\u00F9. ", _jsx(Link, { to: "/playlist", children: "Torna alle playlist" })] }));
    }
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Playlist non disponibile", headingLevel: 1, children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    const { playlist, videos } = state;
    const later = playlist.kind === "later";
    const mine = playlist.owner.id === account.id;
    const share = () => {
        if (!ready(who)) {
            setProblem("Scegli almeno una persona che potrà vederla.");
            return;
        }
        setProblem("");
        const { public: shown, sharedWith } = playlistSharing(who);
        sharePlaylist(playlist.id, { public: shown, sharedWith })
            .then(() => {
            // The page reads it again, for the names of the people chosen.
            return fetchPlaylist(playlist.id);
        })
            .then((page) => {
            setState({ kind: "ready", ...page });
            setMode("view");
        })
            .catch((error) => {
            console.error(error);
            setProblem(error instanceof ApiError && error.status === 400
                ? "Qualcuna delle persone scelte non c'è più: ricarica la pagina e scegli di nuovo."
                : "Non sono riuscito a cambiare chi vede la playlist. Riprova.");
        });
    };
    const rename = async (name) => {
        await renamePlaylist(playlist.id, name);
        setState({ ...state, playlist: { ...playlist, name: name.trim().replace(/\s+/g, " ") } });
        setMode("view");
    };
    const remove = () => {
        setMode("view");
        setProblem("");
        deletePlaylist(playlist.id)
            .then(() => navigate("/playlist"))
            .catch((error) => {
            console.error(error);
            setProblem("Non sono riuscito a eliminare la playlist. Riprova.");
        });
    };
    // takeOut lets the video fade away while the server takes it out of the
    // list; the videos below then glide up.
    const takeOut = (videoId, item) => {
        setProblem("");
        removeSmoothly(item, async () => {
            await putInPlaylist(playlist.id, videoId, false);
        }, () => setState((s) => s.kind === "ready"
            ? {
                ...s,
                playlist: { ...s.playlist, videos: s.playlist.videos - 1 },
                videos: s.videos.filter((v) => v.id !== videoId),
            }
            : s)).catch((error) => {
            console.error(error);
            setProblem("Non sono riuscito a togliere il video. Riprova.");
        });
    };
    return (_jsxs("div", { className: styles.page, children: [_jsx("p", { className: styles.back, children: mine ? (_jsxs(Link, { to: "/playlist", children: [_jsx(Icon, { name: "chevronLeft", size: 16 }), "Tutte le playlist"] })) : !playlist.public ? (_jsxs(Link, { to: "/condivisi", children: [_jsx(Icon, { name: "chevronLeft", size: 16 }), "Condivisi con te"] })) : (_jsxs(Link, { to: `/canale/${playlist.owner.id}`, children: [_jsx(Icon, { name: "chevronLeft", size: 16 }), "Canale di ", playlist.owner.name] })) }), mode === "rename" ? (_jsx(NameForm, { initial: playlist.name, submit: "Salva", failure: "Non sono riuscito a rinominare la playlist. Riprova.", onSubmit: rename, onCancel: () => setMode("view") })) : (_jsxs("div", { className: styles.top, children: [_jsxs("div", { children: [_jsxs("h1", { className: styles.heading, children: [later && _jsx(Icon, { name: "clock", size: 26 }), playlistName(playlist)] }), _jsxs("p", { className: styles.subtitle, children: [formatVideos(playlist.videos), mine ? (!later && ` · ${seenByText(playlist.public, playlist.sharedWith)}`) : (_jsxs(_Fragment, { children: [" · di ", _jsx(Link, { to: `/canale/${playlist.owner.id}`, children: playlist.owner.name })] }))] })] }), mine && !later && mode === "view" && (_jsxs("div", { className: styles.buttons, children: [_jsxs("button", { type: "button", className: `glass ${styles.action}`, onClick: () => {
                                    setWho(choiceOf(!playlist.public, playlist.sharedWith));
                                    setProblem("");
                                    setMode("who");
                                }, children: [_jsx(Icon, { name: "channel", size: 18 }), "Chi la vede"] }), _jsxs("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setMode("rename"), children: [_jsx(Icon, { name: "edit", size: 18 }), "Rinomina"] }), _jsxs("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setMode("delete"), children: [_jsx(Icon, { name: "trash", size: 18 }), "Elimina"] })] })), mode === "who" && (_jsxs("form", { className: `glass ${styles.who}`, "aria-label": "Chi la vede", onSubmit: (event) => {
                            event.preventDefault();
                            share();
                        }, children: [_jsx(WhoSees, { choice: who, onChange: setWho, hints: playlistHints }), _jsxs("div", { className: styles.buttons, children: [_jsx("button", { type: "submit", className: styles.primary, children: "Salva" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => {
                                            setProblem("");
                                            setMode("view");
                                        }, children: "Annulla" })] })] })), mode === "delete" && (_jsxs("div", { className: styles.buttons, children: [_jsx("span", { children: "Eliminare la playlist? I video restano nella libreria." }), _jsx("button", { type: "button", className: `${styles.action} ${styles.danger}`, onClick: remove, children: "S\u00EC, elimina" }), _jsx("button", { type: "button", className: `glass ${styles.action}`, onClick: () => setMode("view"), children: "Annulla" })] }))] })), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), videos.length === 0 ? (_jsx(EmptyState, { title: later ? "Niente da guardare più tardi" : "Playlist vuota", children: mine ? (_jsxs(_Fragment, { children: ["Sotto ogni video premi ", _jsx("strong", { children: "Salva" }), " e scegli", " ", later ? "«Guarda più tardi»" : "questa playlist", ": il video comparir\u00E0 qui."] })) : (`Quando ${playlist.owner.name} aggiungerà dei video, li vedrai qui.`) })) : (_jsx("ol", { className: styles.videos, children: videos.map((video) => (_jsx("li", { "data-flip": true, children: mine ? (_jsx(RemovableCard, { card: _jsx(VideoCard, { video: video, now: now, layout: "row" }), label: `Togli «${video.title}» dalla playlist`, title: "Togli dalla playlist", onRemove: (event) => takeOut(video.id, event.currentTarget.closest("li")) })) : (_jsx(VideoCard, { video: video, now: now, layout: "row" })) }, video.id))) }))] }));
}
// playlistHints say what each choice of who sees it means for a playlist.
const playlistHints = {
    everyone: "Sta sul tuo canale: la vede chiunque usi FranzPLAY.",
    me: "Non la vede nessun altro.",
    people: "La vedono solo le persone che scegli, nella pagina «Condivisi con te». I video privati non ci finiscono mai.",
};
// seenByText says who sees one of my lists.
function seenByText(isPublic, sharedWith) {
    if (isPublic)
        return "sul tuo canale, la vedono tutti";
    if (sharedWith.length === 0)
        return "solo per te";
    return `la vedono anche ${namesList(sharedWith.map((p) => p.name))}`;
}
