import type { CSSProperties } from "react";
import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { formatVideos } from "../../lib/format";
import styles from "./CategoryTile.module.css";
import { tileColor } from "./color";

type Props = {
  // name is the name people see: the color comes from it, so every page
  // shows the same category in the same color.
  name: string;
  videos: number;
  color: string; // the administrator's, "" = none
  image: string | null;
  // to makes the card a link; without it, it is a plain picture of the
  // card (the administrator's preview).
  to?: string;
};

// CategoryTile is the big card of a category. With the administrator's
// image, the picture under a dark shade where the name is. Without one, as
// in the old FranzPLAY: its color fading into dark, a grainy surface and a
// big folder in the corner that straightens up under the mouse. The public
// Categories page and the administrator's preview both draw it, so the
// placeholder is the real card.
export function CategoryTile({ name, videos, color, image, to }: Props) {
  const content = (
    <>
      {image ? (
        <img className={styles.image} src={image} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className={styles.folder}>
          <Icon name="folder" size={160} />
        </span>
      )}
      <span className={styles.name}>{name}</span>
      <span className={styles.count}>{formatVideos(videos)}</span>
    </>
  );
  const common = {
    className: styles.tile,
    "data-image": image ? "" : undefined,
    style: { "--tile-color": tileColor({ name, color }) } as CSSProperties,
  };
  return to ? (
    <Link to={to} {...common}>
      {content}
    </Link>
  ) : (
    <div {...common} data-static="">
      {content}
    </div>
  );
}
