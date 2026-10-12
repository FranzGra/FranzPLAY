import { Route, Routes } from "react-router";
import { AuthPage } from "../features/auth/AuthPage";
import { ComingSoonPage } from "../features/ComingSoonPage";
import { CategoriesPage } from "../features/categories/CategoriesPage";
import { CategoryPage } from "../features/categories/CategoryPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { HomePage } from "../features/home/HomePage";
import { PlaylistPage } from "../features/playlists/PlaylistPage";
import { PlaylistsPage } from "../features/playlists/PlaylistsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SearchPage } from "../features/search/SearchPage";
import { VideoPage } from "../features/video/VideoPage";
import { AuthProvider, useAuth } from "./auth";
import { Layout } from "./Layout";
import { StartupProblem } from "./StartupProblem";

// App shows the login until someone is logged in, then FranzPLAY.
export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { state } = useAuth();
  switch (state.kind) {
    case "loading":
      return <div aria-busy="true" />;
    case "error":
      return <StartupProblem />;
    case "signed-out":
      return <AuthPage mode={state.setupNeeded ? "setup" : "login"} />;
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
        <Route path="cerca" element={<SearchPage />} />
        <Route path="video/:id" element={<VideoPage />} />
        <Route path="cronologia" element={<HistoryPage />} />
        <Route path="categorie" element={<CategoriesPage />} />
        <Route path="categorie/:name" element={<CategoryPage />} />
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
