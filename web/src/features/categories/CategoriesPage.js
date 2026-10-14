import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchCategories } from "../../api/videos";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatVideos } from "../../lib/format";
import styles from "./CategoriesPage.module.css";
import { tileColor } from "./color";
// CategoriesPage lists the categories: the sub-folders of the video folders,
// with the name, color and image the administrator may have given them.
export function CategoriesPage() {
    usePageTitle("Categorie");
    const [state, setState] = useState({ kind: "loading" });
    useEffect(() => {
        const controller = new AbortController();
        fetchCategories(controller.signal)
            .then((categories) => setState({ kind: "ready", categories }))
            .catch((error) => {
            if (!controller.signal.aborted) {
                console.error(error);
                setState({ kind: "error" });
            }
        });
        return () => controller.abort();
    }, []);
    return (_jsxs(_Fragment, { children: [_jsxs("h1", { className: styles.heading, children: [_jsx(Icon, { name: "categories" }), "Categorie"] }), state.kind === "error" && (_jsx(EmptyState, { title: "Categorie non disponibili", children: "Il server non ha risposto. Ricarica la pagina tra poco." })), state.kind === "ready" && state.categories.length === 0 && (_jsx(EmptyState, { title: "Ancora nessuna categoria", children: "Le sottocartelle delle tue cartelle video diventano categorie: per esempio i video in \u00ABVacanze\u00BB finiscono nella categoria Vacanze." })), state.kind === "ready" && state.categories.length > 0 && (_jsx("ul", { className: `stagger ${styles.list}`, children: state.categories.map((category) => (_jsx("li", { children: _jsx(CategoryTile, { category: category }) }, category.name))) }))] }));
}
// CategoryTile is a big card for a category. With the administrator's
// image, the picture under a dark shade where the name is. Without one, as
// in the old FranzPLAY: its color fading into dark, a grainy surface and a
// big folder in the corner that straightens up under the mouse.
function CategoryTile({ category }) {
    const image = category.image;
    return (_jsxs(Link, { to: `/categorie/${encodeURIComponent(category.name)}`, className: styles.tile, "data-image": image ? "" : undefined, style: { "--tile-color": tileColor(category) }, children: [image ? (_jsx("img", { className: styles.image, src: image, alt: "", loading: "lazy", decoding: "async" })) : (_jsx("span", { className: styles.folder, children: _jsx(Icon, { name: "folder", size: 160 }) })), _jsx("span", { className: styles.name, children: category.name }), _jsx("span", { className: styles.count, children: formatVideos(category.videos) })] }));
}
