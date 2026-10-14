import { Link } from "react-router";
import { type Playlist, playlistName } from "../../api/playlists";
import { Icon } from "../../components/Icon";
import { formatVideos } from "../../lib/format";
import styles from "./Playlists.module.css";

// PlaylistCard is a list in a grid. It must not look like one video: its
// cover lies on a small pile of other covers, like a folder of pictures,
// and a dark glass band on its right side says how many videos are inside.
// Under it, the name and what kind of list it is.
// With markPublic it also says when the list is on my channel or shared;
// with showOwner, whose it is.
export function PlaylistCard({
  list,
  markPublic = false,
  showOwner = false,
}: {
  list: Playlist;
  markPublic?: boolean;
  showOwner?: boolean;
}) {
  const icon = list.kind === "later" ? "clock" : "playlist";
  return (
    <Link to={`/playlist/${list.id}`} className={`glow ${styles.card}`}>
      <Pile />
      <span className={styles.cover}>
        {list.cover ? (
          <img src={list.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.noCover}>
            <Icon name={icon} size={32} />
          </span>
        )}
        <span className={styles.band}>
          <strong>{list.videos}</strong>
          <Icon name={icon} size={20} />
        </span>
      </span>
      <span className={styles.cardName}>{playlistName(list)}</span>
      <span className={styles.cardCount}>
        Playlist · {formatVideos(list.videos)}
        {markPublic && list.public && " · sul tuo canale"}
        {markPublic && !list.public && list.sharedWith.length > 0 && " · condivisa"}
        {showOwner && ` · di ${list.owner.name}`}
      </span>
    </Link>
  );
}

// Pile is the two covers peeking out above a collection's cover.
export function Pile() {
  return (
    <span className={styles.stack} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}
