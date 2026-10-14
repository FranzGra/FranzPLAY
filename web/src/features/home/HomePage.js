import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { fetchCategories } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { SiteName } from "../../components/SiteName";
import { ContinueRow } from "../continue/ContinueRow";
import { LikedRow } from "../likes/LikedRow";
import { SavedRow } from "../playlists/SavedRow";
import { RecommendedRow } from "../recommend/RecommendedRow";
import { LatestRow } from "../videos/LatestRow";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import { CategoryChips } from "./CategoryChips";
import styles from "./HomePage.module.css";
import { LookPanel } from "./LookPanel";
import { lookStyle, SectionsContext, useWide } from "./look";
import { useHomeLayout } from "./useHomeLayout";
// HomePage looks like the old FranzPLAY's: a title, the categories to see
// only one of them, then big sections (to continue, saved, liked, newest,
// suggested) and all the videos in a mixed order. Each section can be
// closed by its title, and stays closed for the person on every device.
// On a computer or tablet the person also chooses how many cards in a line,
// how big, and how much of each section to show.
export function HomePage() {
    usePageTitle("");
    const [category, setCategory] = useState("");
    const categories = useCategories();
    const layout = useHomeLayout();
    const wide = useWide();
    const [choosing, setChoosing] = useState(false);
    // A new order at every visit of the Home, the same while it is open.
    const [seed] = useState(() => 1 + Math.floor(Math.random() * 2 ** 31));
    // "Tutti i video" are mixed, as in the old FranzPLAY: the newest have
    // their own row. A category shows its newest first.
    const { state, loadMore } = useVideoList(category ? { category } : { seed });
    return (_jsxs("div", { style: lookStyle(layout.look), children: [_jsxs("header", { className: styles.header, children: [_jsx("span", { className: styles.headerIcon, children: _jsx(Icon, { name: "sparkles", size: 24 }) }), _jsxs("div", { className: styles.headerText, children: [_jsx("h1", { className: styles.headerTitle, children: "Esplora la libreria" }), _jsxs("p", { className: styles.headerSub, children: ["Benvenuto su ", _jsx(SiteName, {})] })] }), wide && layout.ready && (_jsxs("button", { type: "button", className: `glass ${styles.customize}`, "aria-expanded": choosing, onClick: () => setChoosing((c) => !c), children: [_jsx(Icon, { name: "sliders", size: 18 }), "Personalizza"] }))] }), wide && choosing && _jsx(LookPanel, { look: layout.look, onChange: layout.setLook }), categories.length > 0 && (_jsx(CategoryChips, { categories: categories, chosen: category, onChoose: setCategory })), category === "" && layout.ready && (_jsx(SectionsContext.Provider, { value: layout.look.sections, children: _jsxs("div", { className: `stagger ${styles.sections}`, children: [_jsx(ContinueRow, { fold: layout.fold("continue") }), _jsx(SavedRow, { fold: layout.fold("saved") }), _jsx(LikedRow, { fold: layout.fold("liked") }), _jsx(LatestRow, { fold: layout.fold("latest") }), _jsx(RecommendedRow, { fold: layout.fold("recommended") })] }) })), category === "" && _jsx("h2", { className: styles.gridTitle, children: "Tutti i video" }), _jsx(VideoGrid, { state: state, onMore: loadMore, label: category ? `Video di ${category}` : "Tutti i video", empty: {
                    title: "Ancora nessun video",
                    text: "Quando colleghi una cartella video, i tuoi video compariranno qui, con i nuovi arrivi e quelli da continuare a guardare.",
                } })] }));
}
// useCategories loads the categories for the chips. If they do not load,
// the chips simply do not appear: the videos are what matters.
function useCategories() {
    const [categories, setCategories] = useState([]);
    useEffect(() => {
        const controller = new AbortController();
        fetchCategories(controller.signal)
            .then(setCategories)
            .catch((error) => {
            if (!controller.signal.aborted) {
                console.error(error);
            }
        });
        return () => controller.abort();
    }, []);
    return categories;
}
