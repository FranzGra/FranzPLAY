import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { avatarUrl, maySharePublic } from "../../api/auth";
import { type Channel, fetchChannel } from "../../api/channels";
import { ApiError } from "../../api/client";
import { useAccount } from "../../app/auth";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";
import { PlaylistCard } from "../playlists/PlaylistCard";
import listStyles from "../playlists/Playlists.module.css";
import { PublicLinkToggle } from "../public/PublicLinkToggle";
import { useVideoList } from "../videos/useVideoList";
import { VideoGrid } from "../videos/VideoGrid";
import styles from "./ChannelPage.module.css";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; channel: Channel };

// ChannelPage shows a person: their name, since when they are on
// FranzPLAY, the videos they uploaded and the playlists they show to
// everyone.
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
          <Avatar name={channel.name} photo={avatarUrl(channel.id, channel.avatar)} />
        </span>
        <div>
          <h1 className={styles.name}>{channel.name}</h1>
          <p className={styles.since}>
            Su FranzPLAY da {since}
            {mine && " · questo è il tuo canale"}
          </p>
        </div>
      </header>
      <ChannelVideos
        key={channel.id}
        id={channel.id}
        name={channel.name}
        mine={mine}
        canUpload={mine && account.canUpload}
        sharePublic={mine && maySharePublic(account)}
      />
      <h2 className={styles.section}>Playlist</h2>
      {channel.playlists.length === 0 ? (
        mine ? (
          <EmptyState title="Il tuo canale è ancora vuoto">
            Apri una delle tue <Link to="/playlist">playlist</Link> e premi{" "}
            <strong>Chi la vede</strong>, poi <strong>Tutti</strong>: la vedranno tutti, qui.
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

// ChannelVideos shows the videos a person uploaded for everyone. On my
// own channel it shows all of mine, private ones too, each saying who sees
// it. Who never uploaded one sees no empty box, unless it is my channel and
// I may upload: then it says where to start.
function ChannelVideos({
  id,
  name,
  mine,
  canUpload,
  sharePublic,
}: {
  id: number;
  name: string;
  mine: boolean;
  canUpload: boolean;
  // sharePublic: I may make public links, so each of my videos has one.
  sharePublic: boolean;
}) {
  const { state, loadMore } = useVideoList({ uploader: id });
  if (state.kind === "loading") return null;
  const none = state.kind === "ready" && state.videos.length === 0;
  if (none && !canUpload) return null;
  return (
    <>
      <h2 className={styles.section}>{mine ? "I tuoi video" : "Video"}</h2>
      {mine && !none && (
        <p className={styles.hint}>
          Qui vedi tutti i video che hai caricato, con scritto chi può vederli. Gli altri vedono
          solo quelli pubblici. Per cambiare chi li vede, vai a{" "}
          <Link to="/carica">Carica un video</Link>.
        </p>
      )}
      <VideoGrid
        state={state}
        onMore={loadMore}
        label={mine ? "I tuoi video" : `Video caricati da ${name}`}
        below={
          sharePublic
            ? (video) => (
                <PublicLinkToggle videoId={video.id} title={video.title} link={video.publicLink} />
              )
            : undefined
        }
        empty={{
          title: "Nessun video caricato",
          text: "I video che carichi da «Carica un video», nel Profilo, compariranno qui, ognuno con scritto chi può vederlo.",
        }}
      />
    </>
  );
}
