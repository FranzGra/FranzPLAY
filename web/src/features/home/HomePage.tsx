import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";

export function HomePage() {
  usePageTitle("");
  return (
    <>
      <h1 className="visually-hidden">Home</h1>
      <EmptyState title="Ancora nessun video">
        Quando colleghi una cartella video, i tuoi video compariranno qui, con i nuovi arrivi e
        quelli da continuare a guardare.
      </EmptyState>
    </>
  );
}
