import { useSearchParams } from "react-router";
import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";

export function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  usePageTitle(query ? `Cerca: ${query}` : "Cerca");

  return (
    <>
      <h1 className="visually-hidden">Cerca</h1>
      {query ? (
        <EmptyState title="Nessun risultato">Nessun video trovato per «{query}».</EmptyState>
      ) : (
        <EmptyState title="Cerca tra i tuoi video">
          Scrivi un titolo, un canale o una categoria.
        </EmptyState>
      )}
    </>
  );
}
