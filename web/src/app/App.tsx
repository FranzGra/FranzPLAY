import { Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { ComingSoonPage } from "../features/ComingSoonPage";
import { HomePage } from "../features/home/HomePage";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./Layout";
import {
  AccessPage,
  AdminPage,
  AuthPage,
  CategoriesAdminPage,
  CategoriesPage,
  CategoryPage,
  ChannelPage,
  CommentsPage,
  FoldersPage,
  HistoryPage,
  InvitesPage,
  JobsPage,
  JoinPage,
  LikedPage,
  OnlinePage,
  OverviewPage,
  PeoplePage,
  PlaylistPage,
  PlaylistsPage,
  ProfilePage,
  SearchPage,
  SharedPage,
  SitePage,
  SubtitlesPage,
  UploadPage,
  VideoPage,
  VideosPage,
} from "./lazyPages";
import { PageLoading } from "./PageLoading";
import { StartupProblem } from "./StartupProblem";
import { SiteProvider } from "./site";

// App shows the login until someone is logged in, then FranzPLAY.
export function App() {
  return (
    <SiteProvider>
      <AuthProvider>
        <Suspense fallback={<PageLoading />}>
          <Gate />
        </Suspense>
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
          setupCode={state.setupCodeNeeded}
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
        <Route path="carica" element={<UploadPage />} />
        <Route path="canale/:id" element={<ChannelPage />} />
        <Route path="cerca" element={<SearchPage />} />
        <Route path="video/:id" element={<VideoPage />} />
        <Route path="cronologia" element={<HistoryPage />} />
        <Route path="mi-piace" element={<LikedPage />} />
        <Route path="condivisi" element={<SharedPage />} />
        <Route path="categorie" element={<CategoriesPage />} />
        <Route path="categorie/:name" element={<CategoryPage />} />
        <Route path="admin" element={<AdminPage />}>
          <Route index element={<Navigate to="riepilogo" replace />} />
          <Route path="riepilogo" element={<OverviewPage />} />
          <Route path="persone" element={<PeoplePage />} />
          <Route path="inviti" element={<InvitesPage />} />
          <Route path="accessi" element={<AccessPage />} />
          <Route path="video" element={<VideosPage />} />
          <Route path="categorie" element={<CategoriesAdminPage />} />
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
