import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { fetchAudioStart, fetchAudioTracks } from "../../api/audio";
import { avatarUrl } from "../../api/auth";
import { ApiError } from "../../api/client";
import { fetchProgress, saveProgress } from "../../api/progress";
import { fetchSimilar, reasonText } from "../../api/recommend";
import { fetchSubtitles, fetchVideo, playsFileItself, streamURL, } from "../../api/videos";
import { useAccount } from "../../app/auth";
import { usePageWidth } from "../../app/pageWidth";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";
import { formatAge, formatDate } from "../../lib/format";
import { morph } from "../../lib/motion";
import { loadSetting, saveSetting } from "../../lib/storage";
import { Comments } from "../comments/Comments";
import { LikeButton } from "../likes/LikeButton";
import { Player } from "../player/Player";
import { SaveButton } from "../playlists/SaveButton";
import { useSuggestions } from "../recommend/useSuggestions";
import { ShareButton } from "../share/ShareButton";
import { namesList } from "../sharing/audience";
import { VideoCard } from "../videos/VideoCard";
import { Description } from "./Description";
import { subtitleLabel } from "./subtitleLabel";
import { copyHint, useCopy } from "./useCopy";
import styles from "./VideoPage.module.css";
// canPlayType asks this browser whether it can play a kind of video file.
function canPlayType(type) {
    return document.createElement("video").canPlayType(type);
}
// VideoPage is where a video is watched: the player, its details, and
// the videos to watch after it next to it.
export function VideoPage() {
    const param = useParams().id ?? "";
    const id = /^\d+$/.test(param) ? Number(param) : 0;
    const [state, setState] = useState({ kind: "loading" });
    const [theater, toggleTheater] = useTheater();
    usePageWidth(theater ? "full" : "wide");
    usePageTitle(state.kind === "ready"
        ? state.video.title
        : state.kind === "missing"
            ? "Video non trovato"
            : "");
    useEffect(() => {
        if (id <= 0) {
            setState({ kind: "missing" });
            return;
        }
        const controller = new AbortController();
        setState({ kind: "loading" });
        Promise.all([fetchVideo(id, controller.signal), startPosition(id, controller.signal)])
            .then(([video, startAt]) => setState({ kind: "ready", video, startAt }))
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
    switch (state.kind) {
        case "loading":
            return (_jsx("div", { className: layoutClass(theater, false), children: _jsx("div", { className: styles.player, children: _jsx("div", { className: styles.placeholder, "aria-busy": "true" }) }) }));
        case "missing":
            return (_jsxs(EmptyState, { title: "Video non trovato", headingLevel: 1, children: ["Questo video non esiste o non \u00E8 pi\u00F9 disponibile. ", _jsx(Link, { to: "/", children: "Torna alla home" })] }));
        case "error":
            return (_jsx(EmptyState, { title: "Video non disponibile", headingLevel: 1, children: "Il server non ha risposto. Ricarica la pagina tra poco." }));
        case "ready":
            return (_jsx(Watch, { video: state.video, startAt: state.startAt, theater: theater, onTheater: toggleTheater }));
    }
}
// layoutClass arranges the page: the player on the left with the videos
// to watch next on its right, like on YouTube; in theater mode the player
// spans the whole width above them. A private video suggests nothing
// else, so it has no column on the right.
function layoutClass(theater, alone) {
    return [styles.root, theater && styles.theater, alone && styles.alone].filter(Boolean).join(" ");
}
function parseTheater(data) {
    if (typeof data !== "boolean")
        throw new Error("theater: not true or false");
    return data;
}
// useTheater is theater mode, on or off, remembered in this browser for
// the next videos, like on YouTube.
function useTheater() {
    const [theater, setTheater] = useState(() => loadSetting("theater", parseTheater, false));
    // The player grows or shrinks smoothly, and the column of next videos
    // glides to its new place, instead of jumping (morph).
    const toggle = useCallback(() => {
        morph(() => setTheater((on) => {
            saveSetting("theater", !on);
            return !on;
        }));
    }, []);
    return [theater, toggle];
}
// startPosition is where to start the video: where the person stopped,
// or the beginning. Without it the video still plays, so a failure only
// goes to the console.
async function startPosition(id, signal) {
    try {
        return (await fetchProgress(id, signal)).position;
    }
    catch (error) {
        if (!signal.aborted)
            console.error(error);
        return 0;
    }
}
function Watch({ video, startAt, theater, onTheater, }) {
    const [now] = useState(() => new Date());
    const subtitles = useSubtitles(video.id);
    const copy = useCopy(video, canPlayType);
    const audio = useAudio(video.id);
    const findAudio = useCallback((stream, at) => fetchAudioStart(video.id, stream, at), [video.id]);
    const remember = useCallback((seconds) => {
        saveProgress(video.id, seconds).catch((error) => console.error(error));
    }, [video.id]);
    const details = [
        video.author,
        video.publishedOn ? formatDate(video.publishedOn) : formatAge(video.addedAt, now),
        video.height !== null && video.width !== null ? `${Math.min(video.width, video.height)}p` : "",
        video.format,
        subtitleLabel(subtitles),
    ].filter(Boolean);
    return (_jsxs("div", { className: layoutClass(theater, video.private), children: [_jsx("div", { className: styles.player, children: _jsx(Player, { src: streamURL(video.id, video.copy && playsFileItself(video, canPlayType)), poster: video.cover, subtitles: subtitles, startAt: startAt, onPosition: video.private ? undefined : remember, preview: video.preview, audio: audio, findAudio: findAudio, length: video.duration, autoPlay: true, theater: theater, onTheater: onTheater, unsupportedHint: copyHint(video, copy.state, copy.percent), onUnsupported: copy.unsupported }, `${video.id}-${copy.round}`) }), _jsxs("div", { className: styles.info, children: [_jsx("h1", { className: styles.title, children: video.title }), _jsxs("div", { className: styles.bar, children: [video.owner && _jsx(OwnerLink, { owner: video.owner }), _jsxs("div", { className: styles.actions, children: [_jsx(LikeButton, { videoId: video.id }), !video.private && (_jsxs(_Fragment, { children: [_jsx(SaveButton, { videoId: video.id }), _jsx(ShareButton, { title: video.title, path: `/video/${video.id}` })] }))] })] }), _jsxs("p", { className: styles.details, children: [video.category && (_jsx(Link, { to: `/categorie/${encodeURIComponent(video.category)}`, className: styles.category, children: video.category })), _jsx("span", { children: details.join(" · ") })] }), video.private && _jsx(PrivateNote, { video: video }), video.description && (_jsx("div", { className: styles.below, children: _jsx(Description, { text: video.description }) })), _jsx("div", { className: `${styles.below} ${styles.comments}`, children: _jsx(Comments, { videoId: video.id }, video.id) })] }), !video.private && (_jsx("aside", { className: styles.side, "aria-label": "Altri video", children: _jsx(UpNext, { video: video, now: now }) }))] }));
}
// OwnerLink is whose the video is, with their photo, leading to their
// channel: the person who uploaded it, or the main administrator for a
// video from a folder.
function OwnerLink({ owner }) {
    return (_jsxs(Link, { to: `/canale/${owner.id}`, className: styles.owner, children: [_jsx(Avatar, { name: owner.name, photo: avatarUrl(owner.id, owner.avatar) }), _jsx("span", { className: styles.ownerName, children: owner.name })] }));
}
// PrivateNote says who sees a private video: to its uploader, who else and
// where to change it; to someone it was shared with, that few see it.
function PrivateNote({ video }) {
    const me = useAccount();
    if (video.uploader !== null && video.uploader.id !== me.id) {
        return (_jsxs("p", { className: `glass ${styles.private}`, children: [video.uploader.name, " ha condiviso questo video solo con alcune persone, tra cui te. Gli altri non lo vedono."] }));
    }
    const others = video.sharedWith.map((p) => p.name);
    return (_jsxs("p", { className: `glass ${styles.private}`, children: [others.length === 0
                ? "Solo tu vedi questo video."
                : `Questo video lo vedete solo ${namesList(["tu", ...others])}.`, " ", "Per cambiare chi lo vede, vai a \u00ABI tuoi video\u00BB nella pagina", " ", _jsx(Link, { to: "/carica", children: "Carica un video" }), "."] }));
}
// UpNext lists the videos to watch after this one, each saying why.
function UpNext({ video, now }) {
    const load = useCallback((signal) => fetchSimilar(video.id, signal), [video.id]);
    const similar = useSuggestions(load);
    if (similar.length === 0)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("h2", { className: styles.sideTitle, children: "Da guardare dopo" }), _jsx("ul", { className: `stagger ${styles.list}`, children: similar.map((s) => (_jsx("li", { children: _jsx(VideoCard, { video: s.video, now: now, layout: "row", note: reasonText(s) }) }, s.video.id))) })] }));
}
const none = [];
// useSubtitles loads the subtitles of a video. Without them the video
// still plays, so a failure only goes to the console.
function useSubtitles(id) {
    const [tracks, setTracks] = useState(none);
    useEffect(() => {
        const controller = new AbortController();
        setTracks(none);
        fetchSubtitles(id, controller.signal)
            .then(setTracks)
            .catch((error) => {
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, [id]);
    return tracks;
}
const noAudio = [];
// useAudio loads the sound tracks of a video, when there is a choice of
// language. Without them the video still plays in its own language.
function useAudio(id) {
    const [tracks, setTracks] = useState(noAudio);
    useEffect(() => {
        const controller = new AbortController();
        setTracks(noAudio);
        fetchAudioTracks(id, controller.signal)
            .then(setTracks)
            .catch((error) => {
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, [id]);
    return tracks;
}
