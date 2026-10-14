import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fetchPicture, fetchSources, pictureURL, searchOnline, } from "../../api/online";
import { Select } from "../../components/Select";
import styles from "./Admin.module.css";
const sourceNames = { tmdb: "TMDB (film)", tpdb: "ThePornDB" };
// readySources are the sources that can be searched: turned on, with a key.
function readySources(status) {
    const ready = [];
    if (status.tmdb && status.tmdbKey)
        ready.push("tmdb");
    if (status.tpdb && status.tpdbKey)
        ready.push("tpdb");
    return ready;
}
// OnlineSearch lets the administrator search a source on the internet
// with words of their choice, and pick one of the pictures found. The
// picture then goes through the same cut as an uploaded one.
export function OnlineSearch({ title, busy, onPick, }) {
    const [sources, setSources] = useState(null);
    const [source, setSource] = useState("tmdb");
    const [words, setWords] = useState(title);
    const [found, setFound] = useState(null);
    const [searching, setSearching] = useState(false);
    const [problem, setProblem] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        fetchSources(controller.signal)
            .then((status) => {
            const ready = readySources(status);
            setSources(ready);
            if (ready[0])
                setSource(ready[0]);
        })
            .catch((error) => {
            if (controller.signal.aborted)
                return;
            console.error(error);
            setSources([]);
            setProblem("Non si riesce a sapere quali fonti sono accese. Riprova tra poco.");
        });
        return () => controller.abort();
    }, []);
    const search = (event) => {
        event.preventDefault();
        const text = words.trim();
        if (text === "")
            return;
        setSearching(true);
        setProblem("");
        searchOnline(source, text)
            .then(setFound)
            .catch((error) => {
            console.error(error);
            setProblem(problemText(error, source));
        })
            .finally(() => setSearching(false));
    };
    const pick = (candidate) => {
        setSearching(true);
        setProblem("");
        fetchPicture(source, candidate.picture)
            .then(onPick)
            .catch((error) => {
            console.error(error);
            setProblem("Questa immagine non è arrivata. Prova con un'altra.");
        })
            .finally(() => setSearching(false));
    };
    if (sources === null) {
        return _jsx("p", { className: styles.coverNow, children: "Un momento\u2026" });
    }
    if (sources.length === 0) {
        return (_jsx("p", { className: styles.coverNow, children: problem ||
                "Per cercare su internet accendi TMDB o ThePornDB in Amministrazione › Internet, con la loro chiave." }));
    }
    return (_jsxs("div", { className: styles.coverSearch, children: [_jsxs("form", { className: styles.momentControls, onSubmit: search, children: [sources.length > 1 && (_jsxs("label", { className: styles.field, children: ["Dove cercare", _jsx(Select, { "aria-label": "Dove cercare", value: source, options: sources.map((s) => ({ value: s, label: sourceNames[s] })), onChange: (s) => {
                                    setSource(s);
                                    setFound(null);
                                } })] })), _jsxs("label", { className: styles.field, children: ["Cosa cercare", _jsx("input", { type: "search", value: words, maxLength: 200, onChange: (e) => setWords(e.target.value) })] }), _jsx("button", { type: "submit", className: styles.primary, disabled: busy || searching || words.trim() === "", children: "Cerca" })] }), problem && (_jsx("p", { role: "alert", className: styles.problem, children: problem })), found && found.length === 0 && (_jsx("p", { className: styles.coverNow, children: "Nessun risultato. Prova con altre parole." })), found && found.length > 0 && (_jsx("ul", { className: styles.found, "aria-label": "Immagini trovate", children: found.map((c, i) => (_jsx("li", { children: _jsxs("button", { type: "button", className: `glass ${styles.foundItem}`, disabled: busy || searching || c.picture === "", onClick: () => pick(c), children: [c.thumb ? (_jsx("img", { src: pictureURL(source, c.thumb), alt: "", loading: "lazy" })) : (_jsx("span", { className: styles.noPicture, children: "Senza immagine" })), _jsx("span", { className: styles.foundTitle, children: c.title }), _jsx("span", { className: styles.foundMeta, children: [c.date.slice(0, 4), c.author].filter(Boolean).join(" · ") })] }) }, i))) }))] }));
}
function problemText(error, source) {
    const name = source === "tmdb" ? "TMDB" : "ThePornDB";
    if (error instanceof ApiError) {
        switch (error.status) {
            case 409:
                return `${name} è spento: accendilo in Amministrazione › Internet.`;
            case 422:
                return `${name} non accetta più la chiave: salvane una nuova in Amministrazione › Internet.`;
            case 502:
                return `${name} non risponde. Riprova tra poco.`;
        }
    }
    return "La ricerca non è riuscita. Riprova tra poco.";
}
