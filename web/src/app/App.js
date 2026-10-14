import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AccessPage } from "../features/admin/AccessPage";
import { AdminPage } from "../features/admin/AdminPage";
import { CategoriesAdminPage } from "../features/admin/CategoriesAdminPage";
import { CommentsPage } from "../features/admin/CommentsPage";
import { FoldersPage } from "../features/admin/FoldersPage";
import { InvitesPage } from "../features/admin/InvitesPage";
import { JobsPage } from "../features/admin/JobsPage";
import { OnlinePage } from "../features/admin/OnlinePage";
import { OverviewPage } from "../features/admin/OverviewPage";
import { PeoplePage } from "../features/admin/PeoplePage";
import { SitePage } from "../features/admin/SitePage";
import { SubtitlesPage } from "../features/admin/SubtitlesPage";
import { VideosPage } from "../features/admin/VideosPage";
import { AuthPage } from "../features/auth/AuthPage";
import { JoinPage } from "../features/auth/JoinPage";
import { ComingSoonPage } from "../features/ComingSoonPage";
import { CategoriesPage } from "../features/categories/CategoriesPage";
import { CategoryPage } from "../features/categories/CategoryPage";
import { ChannelPage } from "../features/channel/ChannelPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { HomePage } from "../features/home/HomePage";
import { LikedPage } from "../features/likes/LikedPage";
import { PlaylistPage } from "../features/playlists/PlaylistPage";
import { PlaylistsPage } from "../features/playlists/PlaylistsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SearchPage } from "../features/search/SearchPage";
import { SharedPage } from "../features/sharing/SharedPage";
import { UploadPage } from "../features/upload/UploadPage";
import { VideoPage } from "../features/video/VideoPage";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./Layout";
import { StartupProblem } from "./StartupProblem";
import { SiteProvider } from "./site";
// App shows the login until someone is logged in, then FranzPLAY.
export function App() {
    return (_jsx(SiteProvider, { children: _jsx(AuthProvider, { children: _jsx(Gate, {}) }) }));
}
function Gate() {
    const { state } = useAuth();
    // An invite link opens its own page, logged in or not.
    const invite = useLocation().pathname === "/invito";
    if (invite && (state.kind === "signed-out" || state.kind === "signed-in")) {
        return _jsx(JoinPage, {});
    }
    switch (state.kind) {
        case "loading":
            return _jsx("div", { "aria-busy": "true" });
        case "error":
            return _jsx(StartupProblem, {});
        case "signed-out":
            return (_jsx(AuthPage, { mode: state.setupNeeded ? "setup" : "login", setupCode: state.setupCodeNeeded, openRegistration: state.openRegistration }));
        case "signed-in":
            return _jsx(Pages, {});
    }
}
// Pages lists every page of FranzPLAY and its address.
function Pages() {
    return (_jsx(Routes, { children: _jsxs(Route, { element: _jsx(Layout, {}), children: [_jsx(Route, { index: true, element: _jsx(HomePage, {}) }), _jsx(Route, { path: "playlist", element: _jsx(PlaylistsPage, {}) }), _jsx(Route, { path: "playlist/:id", element: _jsx(PlaylistPage, {}) }), _jsx(Route, { path: "profilo", element: _jsx(ProfilePage, {}) }), _jsx(Route, { path: "carica", element: _jsx(UploadPage, {}) }), _jsx(Route, { path: "canale/:id", element: _jsx(ChannelPage, {}) }), _jsx(Route, { path: "cerca", element: _jsx(SearchPage, {}) }), _jsx(Route, { path: "video/:id", element: _jsx(VideoPage, {}) }), _jsx(Route, { path: "cronologia", element: _jsx(HistoryPage, {}) }), _jsx(Route, { path: "mi-piace", element: _jsx(LikedPage, {}) }), _jsx(Route, { path: "condivisi", element: _jsx(SharedPage, {}) }), _jsx(Route, { path: "categorie", element: _jsx(CategoriesPage, {}) }), _jsx(Route, { path: "categorie/:name", element: _jsx(CategoryPage, {}) }), _jsxs(Route, { path: "admin", element: _jsx(AdminPage, {}), children: [_jsx(Route, { index: true, element: _jsx(Navigate, { to: "riepilogo", replace: true }) }), _jsx(Route, { path: "riepilogo", element: _jsx(OverviewPage, {}) }), _jsx(Route, { path: "persone", element: _jsx(PeoplePage, {}) }), _jsx(Route, { path: "inviti", element: _jsx(InvitesPage, {}) }), _jsx(Route, { path: "accessi", element: _jsx(AccessPage, {}) }), _jsx(Route, { path: "video", element: _jsx(VideosPage, {}) }), _jsx(Route, { path: "categorie", element: _jsx(CategoriesAdminPage, {}) }), _jsx(Route, { path: "sottotitoli", element: _jsx(SubtitlesPage, {}) }), _jsx(Route, { path: "commenti", element: _jsx(CommentsPage, {}) }), _jsx(Route, { path: "cartelle", element: _jsx(FoldersPage, {}) }), _jsx(Route, { path: "internet", element: _jsx(OnlinePage, {}) }), _jsx(Route, { path: "lavori", element: _jsx(JobsPage, {}) }), _jsx(Route, { path: "sito", element: _jsx(SitePage, {}) })] }), _jsx(Route, { path: "*", element: _jsx(ComingSoonPage, { title: "Pagina non trovata", text: "Questo indirizzo non esiste." }) })] }) }));
}
