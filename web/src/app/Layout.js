import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { avatarUrl } from "../api/auth";
import { fetchPlaylists, onPlaylistsChanged, playlistName } from "../api/playlists";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { SiteName } from "../components/SiteName";
import { useAccount } from "./auth";
import styles from "./Layout.module.css";
import { PageWidthContext } from "./pageWidth";
// sideLinks are the first links of the side menu; the channel is mine.
function sideLinks(me) {
    return [
        { to: "/", label: "Home", icon: "home" },
        { to: "/cronologia", label: "Cronologia", icon: "history" },
        { to: "/mi-piace", label: "Mi piace", icon: "like" },
        { to: "/condivisi", label: "Condivisi con te", icon: "share" },
        { to: "/categorie", label: "Categorie", icon: "categories" },
        { to: `/canale/${me}`, label: "Il mio canale", icon: "channel" },
    ];
}
// The tabs of the phone bar. Each one also lights up on the pages reached
// from it, so on a phone it is clear where you are: the history, the upload
// and the administration open from the Profile page, for instance.
const tabs = [
    { to: "/", label: "Home", icon: "home", also: ["/cerca"] },
    { to: "/categorie", label: "Categorie", icon: "categories", also: [] },
    { to: "/playlist", label: "Playlist", icon: "playlist", also: ["/mi-piace", "/condivisi"] },
    {
        to: "/profilo",
        label: "Profilo",
        icon: "profile",
        also: ["/cronologia", "/carica", "/admin"],
    },
];
// tabFor says which tab of the phone bar a page belongs to: its index, or
// null for a page of no tab, like a video.
export function tabFor(path) {
    const under = (base) => path === base || path.startsWith(`${base}/`);
    const i = tabs.findIndex((tab) => tab.to === "/" ? path === "/" || tab.also.some(under) : [tab.to, ...tab.also].some(under));
    return i === -1 ? null : i;
}
// Layout is the frame around every page: top bar, side menu on computers,
// bottom bar with four tabs on phones.
export function Layout() {
    const navigate = useNavigate();
    const account = useAccount();
    const lists = useMyPlaylists();
    // "Guarda più tardi" comes first, then "Tutte le playlist", then the
    // lists I made.
    const later = lists.filter((list) => list.kind === "later");
    const mine = lists.filter((list) => list.kind !== "later");
    const [query, setQuery] = useState("");
    const page = useRef(null);
    useEnterOnNavigate(page);
    const currentTab = tabFor(useLocation().pathname);
    const [width, setWidth] = useState("normal");
    function onSearch(event) {
        event.preventDefault();
        const q = query.trim();
        if (q) {
            navigate(`/cerca?q=${encodeURIComponent(q)}`);
        }
    }
    return (_jsxs("div", { className: styles.shell, children: [_jsxs("header", { className: styles.header, children: [_jsxs(Link, { to: "/", className: styles.logo, children: [_jsx("span", { className: styles.logoMark, children: _jsx(Icon, { name: "play", size: 14 }) }), _jsx(SiteName, { accentClass: styles.logoAccent })] }), _jsx("search", { className: styles.search, children: _jsx("form", { onSubmit: onSearch, children: _jsxs("label", { className: `glass ${styles.searchBox}`, children: [_jsx(Icon, { name: "search", size: 18 }), _jsx("span", { className: "visually-hidden", children: "Cerca" }), _jsx("input", { type: "search", placeholder: "Cerca video e persone", value: query, onChange: (event) => setQuery(event.target.value) })] }) }) }), _jsx(Link, { to: "/cerca", className: styles.searchIcon, "aria-label": "Cerca", children: _jsx(Icon, { name: "search" }) }), _jsx(Link, { to: "/profilo", className: styles.avatar, "aria-label": "Il tuo profilo", children: _jsx(Avatar, { name: account.name, size: 40, photo: avatarUrl(account.id, account.avatar) }) })] }), _jsxs("div", { className: styles.body, "data-width": width, children: [_jsxs("nav", { className: styles.sidebar, "aria-label": "Menu principale", children: [sideLinks(account.id).map((link) => (_jsxs(NavLink, { to: link.to, end: true, className: styles.sideLink, children: [_jsx(Icon, { name: link.icon, size: 20 }), link.label] }, link.to))), _jsx("div", { className: styles.sideHeading, children: "Le tue playlist" }), later.map((list) => (_jsx(PlaylistLink, { list: list }, list.id))), _jsxs(NavLink, { to: "/playlist", end: true, className: styles.sideLink, children: [_jsx(Icon, { name: "playlist", size: 20 }), "Tutte le playlist"] }), mine.map((list) => (_jsx(PlaylistLink, { list: list }, list.id))), account.role === "admin" && (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.sideHeading, children: "Gestione" }), _jsxs(NavLink, { to: "/admin", className: styles.sideLink, children: [_jsx(Icon, { name: "shield", size: 20 }), "Amministrazione"] })] }))] }), _jsx("main", { className: styles.main, children: _jsx("div", { ref: page, className: styles.page, children: _jsx(PageWidthContext.Provider, { value: setWidth, children: _jsx(Outlet, {}) }) }) })] }), _jsx("nav", { className: `glass ${styles.tabbar}`, "aria-label": "Menu del telefono", children: tabs.map((tab, i) => (_jsxs(Link, { to: tab.to, className: styles.tab, "aria-current": currentTab === i ? "page" : undefined, children: [_jsx(Icon, { name: tab.icon, size: 26 }), tab.label] }, tab.to))) })] }));
}
// PlaylistLink is one of my lists in the side menu.
function PlaylistLink({ list }) {
    return (_jsxs(NavLink, { to: `/playlist/${list.id}`, className: styles.sideLink, children: [_jsx(Icon, { name: list.kind === "later" ? "clock" : "playlist", size: 20 }), _jsx("span", { className: styles.sideText, children: playlistName(list) })] }));
}
// useEnterOnNavigate makes each new page rise softly into place. It moves
// the page with the browser's own animations instead of drawing it again,
// so what the page already loaded stays as it is. Nothing moves for whoever
// asked their device for less motion.
function useEnterOnNavigate(page) {
    const { pathname } = useLocation();
    // biome-ignore lint/correctness/useExhaustiveDependencies: the animation runs on every new address
    useEffect(() => {
        const element = page.current;
        if (!element?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            return;
        }
        const move = element.animate([
            { opacity: 0, translate: "0 10px" },
            { opacity: 1, translate: "0 0" },
        ], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        return () => move.cancel();
    }, [pathname, page]);
}
// useMyPlaylists loads my lists for the side menu, again after I create,
// rename or delete one. Without them the menu still has "Tutte le
// playlist", so a failure only goes to the console.
function useMyPlaylists() {
    const [lists, setLists] = useState([]);
    useEffect(() => {
        let controller = new AbortController();
        const load = () => {
            controller.abort();
            controller = new AbortController();
            const { signal } = controller;
            fetchPlaylists(undefined, signal)
                .then(setLists)
                .catch((error) => {
                if (!signal.aborted)
                    console.error(error);
            });
        };
        load();
        const stop = onPlaylistsChanged(load);
        return () => {
            stop();
            controller.abort();
        };
    }, []);
    return lists;
}
