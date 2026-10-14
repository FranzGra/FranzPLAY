import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import { PeopleFound, usePeopleFound } from "./PeopleFound";
import styles from "./SearchPage.module.css";

// SearchPage shows the people whose name, and the videos whose title or
// category, contain every searched word. On phones it has its own search box, since the top bar
// only has room for the icon.
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  usePageTitle(query ? `Cerca: ${query}` : "Cerca");
  const [text, setText] = useState(query);
  // A search from the top bar changes the address: show it here too.
  useEffect(() => setText(query), [query]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = text.trim();
    setParams(q ? { q } : {});
  }

  return (
    <>
      <h1 className="visually-hidden">Cerca</h1>
      <search className={styles.search}>
        <form onSubmit={onSubmit}>
          <label className={`glass ${styles.box}`}>
            <Icon name="search" size={18} />
            <span className="visually-hidden">Cerca video e persone</span>
            <input
              type="search"
              placeholder="Cerca video e persone"
              value={text}
              enterKeyHint="search"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        </form>
      </search>
      {query ? (
        <Results key={query} query={query} />
      ) : (
        <EmptyState title="Cerca video e persone">
          Scrivi una o più parole del titolo, della categoria o del nome di una persona.
        </EmptyState>
      )}
    </>
  );
}

function Results({ query }: { query: string }) {
  const { state, loadMore } = useVideoList({ q: query });
  const people = usePeopleFound(query);
  // People found and no video: "no result" would be untrue, so only the
  // people show.
  if (people.length > 0 && state.kind === "ready" && state.videos.length === 0) {
    return <PeopleFound people={people} />;
  }
  return (
    <>
      {people.length > 0 && (
        <>
          <PeopleFound people={people} />
          <h2 className={styles.heading}>Video</h2>
        </>
      )}
      <VideoGrid
        state={state}
        onMore={loadMore}
        label={`Risultati per «${query}»`}
        empty={{ title: "Nessun risultato", text: `Nessun video trovato per «${query}».` }}
      />
    </>
  );
}
