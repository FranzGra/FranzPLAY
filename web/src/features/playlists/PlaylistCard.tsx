import { Link } from "react-router";
import { type Playlist, playlistName } from "../../api/playlists";
import { Icon } from "../../components/Icon";
import { formatVideos } from "../../lib/format";
import styles from "./Playlists.module.css";

// PlaylistCard is a list in a grid: its cover, name and how many videos.
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
  return (
    <Link to={`/playlist/${list.id}`} className={`glow ${styles.card}`}>
      <span className={styles.cover}>
        {list.cover ? (
          <img src={list.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <Icon name={list.kind === "later" ? "clock" : "playlist"} size={32} />
        )}
        <span className={styles.badge}>
          <Icon name={list.kind === "later" ? "clock" : "playlist"} size={14} />
          {list.videos}
        </span>
      </span>
      <span className={styles.cardName}>{playlistName(list)}</span>
      <span className={styles.cardCount}>
        {formatVideos(list.videos)}
        {markPublic && list.public && " · sul tuo canale"}
        {markPublic && !list.public && list.sharedWith.length > 0 && " · condivisa"}
        {showOwner && ` · di ${list.owner.name}`}
      </span>
    </Link>
  );
}
