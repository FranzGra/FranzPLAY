import { Route, Routes } from "react-router";
import { ComingSoonPage } from "../features/ComingSoonPage";
import { HomePage } from "../features/home/HomePage";
import { PlaylistsPage } from "../features/playlists/PlaylistsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SearchPage } from "../features/search/SearchPage";
import { VideoPage } from "../features/video/VideoPage";
import { Layout } from "./Layout";

// App lists every page of FranzPLAY and its address.
export function App() {
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
