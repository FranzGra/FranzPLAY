import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useParams } from "react-router";
import { usePageTitle } from "../../components/PageTitle";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./CategoriesPage.module.css";
// CategoryPage shows the videos of one category.
export function CategoryPage() {
    const name = useParams().name ?? "";
    usePageTitle(name);
    const { state, loadMore } = useVideoList({ category: name });
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: styles.back, children: _jsx(Link, { to: "/categorie", children: "\u2039 Categorie" }) }), _jsx("h1", { className: styles.heading, children: name }), _jsx(VideoGrid, { state: state, onMore: loadMore, label: `Video di ${name}`, empty: {
                    title: "Nessun video qui",
                    text: "Questa categoria è vuota: forse la cartella è stata spostata o rinominata.",
                } })] }));
}
