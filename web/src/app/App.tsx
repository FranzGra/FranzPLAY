import { Route, Routes } from "react-router";
import { AuthPage } from "../features/auth/AuthPage";
import { ComingSoonPage } from "../features/ComingSoonPage";
import { HomePage } from "../features/home/HomePage";
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
        <Route path="profilo" element={<ProfilePage />} />
        <Route path="cerca" element={<SearchPage />} />
        <Route path="video/:id" element={<VideoPage />} />
        <Route
          path="cronologia"
          element={
            <ComingSoonPage title="Cronologia" text="Qui vedrai i video che hai guardato." />
          }
        />
        <Route
          path="categorie"
          element={
            <ComingSoonPage
              title="Categorie"
              text="Le sottocartelle delle tue librerie diventeranno categorie."
            />
          }
        />
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
