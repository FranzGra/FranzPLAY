import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router";
import { createPlaylist, fetchPlaylists, type Playlist } from "../../api/playlists";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { NameForm } from "./NameForm";
import { PlaylistCard } from "./PlaylistCard";
import styles from "./Playlists.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; lists: Playlist[] };

// PlaylistsPage shows my lists: "Guarda più tardi" first, then the
// videos I like, then the lists I made, and lets me make a new one.
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
        <ul className={`stagger ${styles.grid}`}>
          {state.lists.map((list) => (
            <Fragment key={list.id}>
              <li>
                <PlaylistCard list={list} markPublic />
              </li>
              {list.kind === "later" && (
                <>
                  <LikedCard />
                  <SharedCard />
                </>
              )}
            </Fragment>
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

// LikedCard leads to the videos I like: on phones this page is the way
// there, since the bottom bar has only three tabs.
function LikedCard() {
  return (
    <li>
      <Link to="/mi-piace" className={`glow ${styles.card}`}>
        <span className={styles.cover}>
          <Icon name="like" size={32} />
        </span>
        <span className={styles.cardName}>Mi piace</span>
        <span className={styles.cardCount}>I video che ti piacciono</span>
      </Link>
    </li>
  );
}

// SharedCard leads to what others shared only with some people, me among
// them: on phones too, from here.
function SharedCard() {
  return (
    <li>
      <Link to="/condivisi" className={`glow ${styles.card}`}>
        <span className={styles.cover}>
          <Icon name="share" size={32} />
        </span>
        <span className={styles.cardName}>Condivisi con te</span>
        <span className={styles.cardCount}>Solo per te e pochi altri</span>
      </Link>
    </li>
  );
}
