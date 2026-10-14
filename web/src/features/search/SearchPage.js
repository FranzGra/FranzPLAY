import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import { PeopleFound, usePeopleFound } from "./PeopleFound";
import styles from "./SearchPage.module.css";
// SearchPage shows the people whose name, and the videos whose title or
// category, contain every searched word. On phones it has its own search box, since the top bar
// only has room for the icon.
export function SearchPage() {
    const [params, setParams] = useSearchParams();
    const query = params.get("q")?.trim() ?? "";
    usePageTitle(query ? `Cerca: ${query}` : "Cerca");
    const [text, setText] = useState(query);
    // A search from the top bar changes the address: show it here too.
    useEffect(() => setText(query), [query]);
    function onSubmit(event) {
        event.preventDefault();
        const q = text.trim();
        setParams(q ? { q } : {});
    }
    return (_jsxs(_Fragment, { children: [_jsx("h1", { className: "visually-hidden", children: "Cerca" }), _jsx("search", { className: styles.search, children: _jsx("form", { onSubmit: onSubmit, children: _jsxs("label", { className: `glass ${styles.box}`, children: [_jsx(Icon, { name: "search", size: 18 }), _jsx("span", { className: "visually-hidden", children: "Cerca video e persone" }), _jsx("input", { type: "search", placeholder: "Cerca video e persone", value: text, enterKeyHint: "search", onChange: (event) => setText(event.target.value) })] }) }) }), query ? (_jsx(Results, { query: query }, query)) : (_jsx(EmptyState, { title: "Cerca video e persone", children: "Scrivi una o pi\u00F9 parole del titolo, della categoria o del nome di una persona." }))] }));
}
function Results({ query }) {
    const { state, loadMore } = useVideoList({ q: query });
    const people = usePeopleFound(query);
    // People found and no video: "no result" would be untrue, so only the
    // people show.
    if (people.length > 0 && state.kind === "ready" && state.videos.length === 0) {
        return _jsx(PeopleFound, { people: people });
    }
    return (_jsxs(_Fragment, { children: [people.length > 0 && (_jsxs(_Fragment, { children: [_jsx(PeopleFound, { people: people }), _jsx("h2", { className: styles.heading, children: "Video" })] })), _jsx(VideoGrid, { state: state, onMore: loadMore, label: `Risultati per «${query}»`, empty: { title: "Nessun risultato", text: `Nessun video trovato per «${query}».` } })] }));
}
