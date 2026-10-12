import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";

export function PlaylistsPage() {
  usePageTitle("Playlist");
  return (
    <>
      <h1 className="visually-hidden">Playlist</h1>
      <EmptyState title="Nessuna playlist">
        Qui troverai le tue playlist e "Guarda più tardi". Potrai crearle dalla pagina di ogni
        video.
      </EmptyState>
    </>
  );
}
