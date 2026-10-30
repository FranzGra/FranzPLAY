import type { CSSProperties } from "react";
import { avatarUrl } from "../api/auth";
import type { Owner } from "../api/videos";
import { Avatar } from "./Avatar";
import styles from "./Byline.module.css";
import { Icon } from "./Icon";
import { SiteName } from "./SiteName";

// Byline is whose a video is, as its page and its card show it: the photo
// and name of the person who uploaded it, or for the site's own video
// (owner null: from a video folder, or its uploader left) the site's logo
// and its name in two parts, as the administrator chose them. size is the
// side of the picture in pixels.
export function Byline({
  owner,
  size,
  nameClass,
}: {
  owner: Owner | null;
  size: number;
  nameClass?: string;
}) {
  if (owner === null) {
    return (
      <>
        <SiteMark size={size} />
        <span className={nameClass}>
          <SiteName accentClass={styles.accent} />
        </span>
      </>
    );
  }
  return (
    <>
      <Avatar name={owner.name} size={size} photo={avatarUrl(owner.id, owner.avatar)} />
      <span className={nameClass}>{owner.name}</span>
    </>
  );
}

// SiteMark is the site's logo, the play sign of the top bar, as big as an
// avatar would be in its place.
function SiteMark({ size }: { size: number }) {
  return (
    <span
      className={styles.mark}
      style={{ "--avatar-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
      data-site-mark
    >
      <Icon name="play" size={Math.round(size * 0.45)} />
    </span>
  );
}
