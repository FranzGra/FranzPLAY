import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { fetchSharedPlaylists } from "../../api/playlists";
import { fetchVideos } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { PlaylistCard } from "../playlists/PlaylistCard";
import { usePagedVideos } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./SharedPage.module.css";
// SharedPage lists what others shared only with some people, me among
// them: playlists first, then videos. They show up nowhere else.
export function SharedPage() {
    usePageTitle("Condivisi con te");
    const load = useCallback((page, signal) => fetchVideos({ shared: true, ...page }, signal), []);
    const { state, loadMore } = usePagedVideos(load);
    const lists = useSharedPlaylists();
    return (_jsxs(_Fragment, { children: [_jsxs("h1", { className: styles.heading, children: [_jsx(Icon, { name: "share", size: 26 }), "Condivisi con te"] }), lists.length > 0 && (_jsxs("section", { className: styles.section, "aria-label": "Playlist condivise con te", children: [_jsx("h2", { className: styles.subheading, children: "Playlist" }), _jsx("ul", { className: `stagger ${styles.lists}`, children: lists.map((list) => (_jsx("li", { children: _jsx(PlaylistCard, { list: list, showOwner: true }) }, list.id))) }), _jsx("h2", { className: styles.subheading, children: "Video" })] })), _jsx(VideoGrid, { state: state, onMore: loadMore, label: "Video condivisi con te", empty: lists.length > 0
                    ? {
                        title: "Nessun video condiviso con te",
                        text: "Quando qualcuno ti farà vedere un suo video solo ad alcune persone, lo troverai qui.",
                    }
                    : {
                        title: "Nessuno ti ha condiviso niente, per ora",
                        text: "Quando qualcuno fa vedere un suo video o una sua playlist solo ad alcune persone, te compreso, li trovi qui.",
                    } })] }));
}
// useSharedPlaylists returns the playlists shared with me; none while
// they arrive or if the server does not answer, since the videos below
// still make sense on their own.
function useSharedPlaylists() {
    const [lists, setLists] = useState([]);
    useEffect(() => {
        const controller = new AbortController();
        fetchSharedPlaylists(controller.signal)
            .then(setLists)
            .catch((error) => {
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, []);
    return lists;
}
