import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "react-router";
import { playlistName } from "../../api/playlists";
import { Icon } from "../../components/Icon";
import { formatVideos } from "../../lib/format";
import styles from "./Playlists.module.css";
// PlaylistCard is a list in a grid. It must not look like one video: its
// cover lies on a small pile of other covers, like a folder of pictures,
// and a dark glass band on its right side says how many videos are inside.
// Under it, the name and what kind of list it is.
// With markPublic it also says when the list is on my channel or shared;
// with showOwner, whose it is.
export function PlaylistCard({ list, markPublic = false, showOwner = false, }) {
    const icon = list.kind === "later" ? "clock" : "playlist";
    return (_jsxs(Link, { to: `/playlist/${list.id}`, className: `glow ${styles.card}`, children: [_jsx(Pile, {}), _jsxs("span", { className: styles.cover, children: [list.cover ? (_jsx("img", { src: list.cover, alt: "", loading: "lazy", decoding: "async" })) : (_jsx("span", { className: styles.noCover, children: _jsx(Icon, { name: icon, size: 32 }) })), _jsxs("span", { className: styles.band, children: [_jsx("strong", { children: list.videos }), _jsx(Icon, { name: icon, size: 20 })] })] }), _jsx("span", { className: styles.cardName, children: playlistName(list) }), _jsxs("span", { className: styles.cardCount, children: ["Playlist \u00B7 ", formatVideos(list.videos), markPublic && list.public && " · sul tuo canale", markPublic && !list.public && list.sharedWith.length > 0 && " · condivisa", showOwner && ` · di ${list.owner.name}`] })] }));
}
// Pile is the two covers peeking out above a collection's cover.
export function Pile() {
    return (_jsxs("span", { className: styles.stack, "aria-hidden": "true", children: [_jsx("span", {}), _jsx("span", {})] }));
}
