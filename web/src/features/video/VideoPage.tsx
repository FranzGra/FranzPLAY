import { Link } from "react-router";
import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";

export function VideoPage() {
  usePageTitle("Video non trovato");
  return (
    <>
      <h1 className="visually-hidden">Video</h1>
      <EmptyState title="Video non trovato">
        Questo video non esiste o non è più disponibile. <Link to="/">Torna alla home</Link>
      </EmptyState>
    </>
  );
}
