import type { CSSProperties } from "react";
import { Link } from "react-router";
import type { CategoryShape } from "../../api/site";
import { useSite } from "../../app/site";
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
  image: string | null; // the wide picture: the administrator's, or one in its folder
  poster?: string | null; // a tall picture in its folder, used without a wide one
  // to makes the card a link; without it, it is a plain picture of the
  // card (the administrator's preview).
  to?: string;
  // shape is the shape of the card; without it, the one the administrator
  // chose for every category in the site's settings.
  shape?: CategoryShape;
};

// CategoryTile is the big card of a category. With a wide image (chosen by
// the administrator, or found in its folder), the picture under a dark
// shade where the name is. With only a tall poster from its folder, the
// poster stands in the corner of its colored card, like a book on a shelf.
// Without either, as in the old FranzPLAY: its color fading into dark, a
// grainy surface and a big folder in the corner that straightens up under
// the mouse. The public Categories page and the administrator's preview
// both draw it, so the placeholder is the real card.
//
// A tall or square card has no room for a poster in the corner: the
// picture that fits its shape best fills it (the poster for a tall card,
// the wide picture for a square one), cut at the edges, never stretched.
export function CategoryTile({ name, videos, color, image, poster, to, shape }: Props) {
  const site = useSite();
  const form = shape ?? site.look.categoryShape;
  const filled =
    form === "landscape" ? image : form === "portrait" ? (poster ?? image) : (image ?? poster);
  const corner = form === "landscape" && !image ? poster : null;
  const content = (
    <>
      {filled ? (
        <img className={styles.image} src={filled} alt="" loading="lazy" decoding="async" />
      ) : corner ? (
        <img className={styles.poster} src={corner} alt="" loading="lazy" decoding="async" />
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
    "data-shape": form,
    "data-image": filled ? "" : undefined,
    "data-poster": corner ? "" : undefined,
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
