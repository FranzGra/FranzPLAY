import { Navigate, Route, Routes, useLocation } from "react-router";
import { AccessPage } from "../features/admin/AccessPage";
import { AdminPage } from "../features/admin/AdminPage";
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
import { VideoPage } from "../features/video/VideoPage";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./Layout";
import { StartupProblem } from "./StartupProblem";
import { SiteProvider } from "./site";

// App shows the login until someone is logged in, then FranzPLAY.
export function App() {
  return (
    <SiteProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SiteProvider>
  );
}

function Gate() {
  const { state } = useAuth();
  // An invite link opens its own page, logged in or not.
  const invite = useLocation().pathname === "/invito";
  if (invite && (state.kind === "signed-out" || state.kind === "signed-in")) {
    return <JoinPage />;
  }
  switch (state.kind) {
    case "loading":
      return <div aria-busy="true" />;
    case "error":
      return <StartupProblem />;
    case "signed-out":
      return (
        <AuthPage
          mode={state.setupNeeded ? "setup" : "login"}
          openRegistration={state.openRegistration}
        />
      );
    case "signed-in":
      return <Pages />;
  }
}

// Pages lists every page of FranzPLAY and its address.
function Pages() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="playlist" element={<PlaylistsPage />} />
        <Route path="playlist/:id" element={<PlaylistPage />} />
        <Route path="profilo" element={<ProfilePage />} />
        <Route path="canale/:id" element={<ChannelPage />} />
        <Route path="cerca" element={<SearchPage />} />
        <Route path="video/:id" element={<VideoPage />} />
        <Route path="cronologia" element={<HistoryPage />} />
        <Route path="mi-piace" element={<LikedPage />} />
        <Route path="categorie" element={<CategoriesPage />} />
        <Route path="categorie/:name" element={<CategoryPage />} />
        <Route path="admin" element={<AdminPage />}>
          <Route index element={<Navigate to="riepilogo" replace />} />
          <Route path="riepilogo" element={<OverviewPage />} />
          <Route path="persone" element={<PeoplePage />} />
          <Route path="inviti" element={<InvitesPage />} />
          <Route path="accessi" element={<AccessPage />} />
          <Route path="video" element={<VideosPage />} />
          <Route path="sottotitoli" element={<SubtitlesPage />} />
          <Route path="commenti" element={<CommentsPage />} />
          <Route path="cartelle" element={<FoldersPage />} />
          <Route path="internet" element={<OnlinePage />} />
          <Route path="lavori" element={<JobsPage />} />
          <Route path="sito" element={<SitePage />} />
        </Route>
        <Route
          path="*"
          element={
            <ComingSoonPage title="Pagina non trovata" text="Questo indirizzo non esiste." />
          }
        />
      </Route>
    </Routes>
  );
}
