import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { type Channel, fetchChannel } from "../../api/channels";
import { ApiError } from "../../api/client";
import { useAccount } from "../../app/auth";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";
import { PlaylistCard } from "../playlists/PlaylistCard";
import listStyles from "../playlists/Playlists.module.css";
import styles from "./ChannelPage.module.css";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; channel: Channel };

// ChannelPage shows a person: their name, since when they are on
// FranzPLAY, and the playlists they show to everyone.
export function ChannelPage() {
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
  const account = useAccount();
  const [state, setState] = useState<State>({ kind: "loading" });
  usePageTitle(
    state.kind === "ready"
      ? state.channel.name
      : state.kind === "missing"
        ? "Canale non trovato"
        : "",
  );

  useEffect(() => {
    if (id <= 0) {
      setState({ kind: "missing" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchChannel(id, controller.signal)
      .then((channel) => setState({ kind: "ready", channel }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [id]);

  if (state.kind === "loading") return <div className={listStyles.placeholder} aria-busy="true" />;
  if (state.kind === "missing") {
    return (
      <EmptyState title="Canale non trovato" headingLevel={1}>
        Questa persona non è più su FranzPLAY. <Link to="/">Torna alla Home</Link>
      </EmptyState>
    );
  }
  if (state.kind === "error") {
    return (
      <EmptyState title="Canale non disponibile" headingLevel={1}>
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }

  const { channel } = state;
  const mine = channel.id === account.id;
  const since = channel.since.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  return (
    <>
      <header className={styles.identity}>
        <span className={styles.avatar}>
          <Avatar name={channel.name} />
        </span>
        <div>
          <h1 className={styles.name}>{channel.name}</h1>
          <p className={styles.since}>
            Su FranzPLAY da {since}
            {mine && " · questo è il tuo canale"}
          </p>
        </div>
      </header>
      <h2 className={styles.section}>Playlist</h2>
      {channel.playlists.length === 0 ? (
        mine ? (
          <EmptyState title="Il tuo canale è ancora vuoto">
            Apri una delle tue <Link to="/playlist">playlist</Link> e premi{" "}
            <strong>Sul mio canale</strong>: la vedranno tutti, qui.
          </EmptyState>
        ) : (
          <EmptyState title="Nessuna playlist pubblica">
            Quando {channel.name} mostrerà una playlist sul suo canale, la vedrai qui.
          </EmptyState>
        )
      ) : (
        <ul className={listStyles.grid}>
          {channel.playlists.map((list) => (
            <li key={list.id}>
              <PlaylistCard list={list} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
