import { Link } from "react-router";
import type { Video } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { formatAge, formatDuration } from "../../lib/format";
import styles from "./VideoCard.module.css";

type VideoCardProps = {
  video: Video;
  now: Date;
  // row puts the cover beside the text, for the list next to the player.
  layout?: "grid" | "row";
  // position is where the person stopped, in seconds: a bar on the cover
  // shows how much was watched.
  position?: number;
  // note is one more line under the details, like why it is suggested.
  note?: string;
};

// VideoCard is a video in a grid: cover with its duration, title, and
// category with how long ago it arrived.
export function VideoCard({ video, now, layout = "grid", position, note }: VideoCardProps) {
  const details = [video.category, formatAge(video.addedAt, now)].filter(Boolean).join(" · ");
  const watched =
    position !== undefined && video.duration ? Math.min(1, position / video.duration) : null;
  return (
    <Link to={`/video/${video.id}`} className={styles.root} data-layout={layout}>
      <div className={styles.cover}>
        {video.cover ? (
          <img src={video.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.noCover}>
            <Icon name="play" size={28} />
          </span>
        )}
        {video.duration !== null && (
          <span className={styles.duration}>{formatDuration(video.duration)}</span>
        )}
        {watched !== null && (
          <span className={styles.watched}>
            <span style={{ width: `${watched * 100}%` }} />
            <span className="visually-hidden">Visto al {Math.round(watched * 100)}%</span>
          </span>
        )}
      </div>
      <div className={styles.text}>
        <h3 className={styles.title}>{video.title}</h3>
        <p className={styles.details}>{details}</p>
        {note && <p className={styles.note}>{note}</p>}
      </div>
    </Link>
  );
}
