import { useState } from "react";
import { Link } from "react-router";
import type { Video } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { goodConnection } from "../../lib/connection";
import { formatAge, formatDuration } from "../../lib/format";
import { useClipPreview } from "./useClipPreview";
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
// category with how long ago it arrived and how many people like it. Resting the mouse on it
// plays a few silent seconds of the video; on a touch screen the card that
// stays in the middle of the screen plays them.
export function VideoCard({ video, now, layout = "grid", position, note }: VideoCardProps) {
  const { playing, handlers, coverRef } = useClipPreview(video.clip, layout === "grid");
  const details = [video.category, formatAge(video.addedAt, now)].filter(Boolean).join(" · ");
  const watched =
    position !== undefined && video.duration ? Math.min(1, position / video.duration) : null;
  return (
    <Link
      to={`/video/${video.id}`}
      className={`glow ${styles.root}`}
      data-layout={layout}
      {...handlers}
    >
      <div ref={coverRef} className={styles.cover}>
        {video.cover ? (
          <img src={video.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={styles.noCover}>
            <Icon name="play" size={28} />
          </span>
        )}
        {playing && video.clip && <Clip src={chooseClip(video.clip, video.clipHD)} />}
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
        <p className={styles.details}>
          {details}
          {video.likes > 0 && (
            <span className={styles.likes}>
              <Icon name="like" size={13} />
              {video.likes}
              <span className="visually-hidden">
                {video.likes === 1 ? " mi piace" : " persone a cui piace"}
              </span>
            </span>
          )}
        </p>
        {note && <p className={styles.note}>{note}</p>}
      </div>
    </Link>
  );
}

// chooseClip picks which clip plays: the sharp one on a good connection,
// like the Wi-Fi at home, the light one otherwise. It asks each time a clip
// starts, so a phone leaving home switches to the light ones.
function chooseClip(clip: string, clipHD: string | null): string {
  return clipHD !== null && goodConnection() ? clipHD : clip;
}

// Clip plays a few silent seconds over the cover. It is made only while it
// plays, so nothing is downloaded before, and it shows once it really
// moves, so the cover stays while it loads.
function Clip({ src }: { src: string }) {
  const [moving, setMoving] = useState(false);
  return (
    <video
      className={styles.clip}
      data-moving={moving || undefined}
      src={src}
      muted
      loop
      playsInline
      autoPlay
      disablePictureInPicture
      data-testid="clip"
      onPlaying={() => setMoving(true)}
    />
  );
}
