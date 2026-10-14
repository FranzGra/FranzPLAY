import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useAccount } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import styles from "./Admin.module.css";
// sections are the pages of the administration, in the order shown.
const sections = [
    { to: "riepilogo", label: "Riepilogo" },
    { to: "persone", label: "Persone" },
    { to: "inviti", label: "Inviti" },
    { to: "accessi", label: "Accessi" },
    { to: "video", label: "Video" },
    { to: "categorie", label: "Categorie" },
    { to: "sottotitoli", label: "Sottotitoli" },
    { to: "commenti", label: "Commenti" },
    { to: "cartelle", label: "Cartelle" },
    { to: "internet", label: "Internet" },
    { to: "lavori", label: "Lavori" },
    { to: "sito", label: "Sito" },
];
// AdminPage is the frame of the administration pages: only the
// administrator sees them.
export function AdminPage() {
    usePageTitle("Amministrazione");
    const account = useAccount();
    const tabs = useRef(null);
    const { pathname } = useLocation();
    // On a narrow screen the row of tabs slides sideways: bring the open
    // page's tab to the middle, so the person always sees where they are.
    // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is the reason to scroll
    useEffect(() => {
        const row = tabs.current;
        const open = row?.querySelector('[aria-current="page"]');
        if (!row || !open || row.scrollWidth <= row.clientWidth)
            return;
        row.scrollLeft = open.offsetLeft - (row.clientWidth - open.offsetWidth) / 2;
    }, [pathname]);
    if (account.role !== "admin") {
        return (_jsx(EmptyState, { title: "Solo per l'amministratore", headingLevel: 1, children: "Queste pagine servono a chi gestisce FranzPLAY." }));
    }
    return (_jsxs(_Fragment, { children: [_jsxs("h1", { className: styles.heading, children: [_jsx(Icon, { name: "shield", size: 26 }), "Amministrazione"] }), _jsx("nav", { ref: tabs, className: `glass ${styles.tabs}`, "aria-label": "Sezioni dell'amministrazione", children: sections.map((s) => (_jsx(NavLink, { to: s.to, className: styles.tab, children: s.label }, s.to))) }), _jsx(Outlet, {})] }));
}
