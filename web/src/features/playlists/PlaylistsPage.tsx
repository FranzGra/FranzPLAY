import { useEffect, useState } from "react";
import { createPlaylist, fetchPlaylists, type Playlist } from "../../api/playlists";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { NameForm } from "./NameForm";
import { PlaylistCard } from "./PlaylistCard";
import styles from "./Playlists.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; lists: Playlist[] };

// PlaylistsPage shows my lists: "Guarda più tardi" first, then the ones
// I made, and lets me make a new one.
export function PlaylistsPage() {
  usePageTitle("Playlist");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [making, setMaking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchPlaylists(undefined, controller.signal)
      .then((lists) => setState({ kind: "ready", lists }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  const make = async (name: string) => {
    const list = await createPlaylist(name);
    setState((s) => {
      if (s.kind !== "ready") return s;
      const [later, ...mine] = s.lists;
      return { kind: "ready", lists: later ? [later, list, ...mine] : [list] };
    });
    setMaking(false);
  };

  return (
    <>
      <div className={styles.top}>
        <h1 className={styles.heading}>
          <Icon name="playlist" size={26} />
          Playlist
        </h1>
        {state.kind === "ready" && !making && (
          <button
            type="button"
            className={`glass ${styles.action}`}
            onClick={() => setMaking(true)}
          >
            <Icon name="plus" size={18} />
            Nuova playlist
          </button>
        )}
      </div>
      {making && (
        <NameForm
          submit="Crea"
          failure="Non sono riuscito a creare la playlist. Riprova."
          onSubmit={make}
          onCancel={() => setMaking(false)}
        />
      )}
      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "error" && (
        <EmptyState title="Playlist non disponibili">
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      )}
      {state.kind === "ready" && (
        <ul className={styles.grid}>
          {state.lists.map((list) => (
            <li key={list.id}>
              <PlaylistCard list={list} markPublic />
            </li>
          ))}
        </ul>
      )}
      {state.kind === "ready" && state.lists.length === 1 && !making && (
        <p className={styles.hint}>
          Per fare una playlist premi <strong>Nuova playlist</strong>, oppure <strong>Salva</strong>{" "}
          sotto un video.
        </p>
      )}
    </>
  );
}
