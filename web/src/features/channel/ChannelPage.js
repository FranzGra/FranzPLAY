import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { avatarUrl } from "../../api/auth";
import { fetchChannel } from "../../api/channels";
import { ApiError } from "../../api/client";
import { useAccount } from "../../app/auth";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";
import { PlaylistCard } from "../playlists/PlaylistCard";
import listStyles from "../playlists/Playlists.module.css";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./ChannelPage.module.css";
// ChannelPage shows a person: their name, since when they are on
// FranzPLAY, the videos they uploaded and the playlists they show to
// everyone.
export function ChannelPage() {
    const param = useParams().id ?? "";
    const id = /^\d+$/.test(param) ? Number(param) : 0;
    const account = useAccount();
    const [state, setState] = useState({ kind: "loading" });
    usePageTitle(state.kind === "ready"
        ? state.channel.name
        : state.kind === "missing"
            ? "Canale non trovato"
            : "");
    useEffect(() => {
        if (id <= 0) {
            setState({ kind: "missing" });
            return;
        }
        const controller = new AbortController();
        setState({ kind: "loading" });
        fetchChannel(id, controller.signal)
            .then((channel) => setState({ kind: "ready", channel }))
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
        return _jsx("div", { className: listStyles.placeholder, "aria-busy": "true" });
    if (state.kind === "missing") {
        return (_jsxs(EmptyState, { title: "Canale non trovato", headingLevel: 1, children: ["Questa persona non \u00E8 pi\u00F9 su FranzPLAY. ", _jsx(Link, { to: "/", children: "Torna alla Home" })] }));
    }
    if (state.kind === "error") {
        return (_jsx(EmptyState, { title: "Canale non disponibile", headingLevel: 1, children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
    }
    const { channel } = state;
    const mine = channel.id === account.id;
    const since = channel.since.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
    return (_jsxs(_Fragment, { children: [_jsxs("header", { className: styles.identity, children: [_jsx("span", { className: styles.avatar, children: _jsx(Avatar, { name: channel.name, photo: avatarUrl(channel.id, channel.avatar) }) }), _jsxs("div", { children: [_jsx("h1", { className: styles.name, children: channel.name }), _jsxs("p", { className: styles.since, children: ["Su FranzPLAY da ", since, mine && " · questo è il tuo canale"] })] })] }), _jsx(ChannelVideos, { id: channel.id, name: channel.name, canUpload: mine && account.canUpload }, channel.id), _jsx("h2", { className: styles.section, children: "Playlist" }), channel.playlists.length === 0 ? (mine ? (_jsxs(EmptyState, { title: "Il tuo canale \u00E8 ancora vuoto", children: ["Apri una delle tue ", _jsx(Link, { to: "/playlist", children: "playlist" }), " e premi", " ", _jsx("strong", { children: "Chi la vede" }), ", poi ", _jsx("strong", { children: "Tutti" }), ": la vedranno tutti, qui."] })) : (_jsxs(EmptyState, { title: "Nessuna playlist pubblica", children: ["Quando ", channel.name, " mostrer\u00E0 una playlist sul suo canale, la vedrai qui."] }))) : (_jsx("ul", { className: listStyles.grid, children: channel.playlists.map((list) => (_jsx("li", { children: _jsx(PlaylistCard, { list: list }) }, list.id))) }))] }));
}
// ChannelVideos shows the videos a person uploaded for everyone. Who
// never uploaded one sees no empty box, unless it is my channel and I
// may upload: then it says where to start.
function ChannelVideos({ id, name, canUpload }) {
    const { state, loadMore } = useVideoList({ uploader: id });
    if (state.kind === "loading")
        return null;
    if (state.kind === "ready" && state.videos.length === 0 && !canUpload)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("h2", { className: styles.section, children: "Video" }), _jsx(VideoGrid, { state: state, onMore: loadMore, label: `Video caricati da ${name}`, empty: {
                    title: "Nessun video caricato",
                    text: "I video che carichi da «Carica un video», nel Profilo, compariranno qui per tutti.",
                } })] }));
}
