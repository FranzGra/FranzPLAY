import { Link } from "react-router";
import type { AdminVideo } from "../../api/adminVideos";
import { formatDuration } from "../../lib/format";
import styles from "./Admin.module.css";
import { compatibility, qualityLabel } from "./quality";

// VideoTable shows the videos as a compact table, many at a glance: what
// the file is, how sharp, and whether every browser plays it. To change a
// video, the administrator switches back to the cards.
export function VideoTable({ videos }: { videos: AdminVideo[] }) {
  return (
    <div className={`glass ${styles.tableBox}`}>
      <table className={styles.table} aria-label="Video">
        <thead>
          <tr>
            <th scope="col">Titolo</th>
            <th scope="col">Categoria</th>
            <th scope="col">Durata</th>
            <th scope="col">Qualità</th>
            <th scope="col">Formato</th>
            <th scope="col">Browser</th>
            <th scope="col">Stato</th>
            <th scope="col">Pubblico</th>
            <th scope="col">
              <span className="visually-hidden">Azioni</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {videos.map((video) => {
            const compat = compatibility(video);
            return (
              <tr key={video.id}>
                <th scope="row" className={styles.tableTitle}>
                  {video.hidden || video.missing || video.tooShort ? (
                    video.title
                  ) : (
                    <Link to={`/video/${video.id}`}>{video.title}</Link>
                  )}
                  <span className={`${styles.role} ${styles.path}`}>{video.path}</span>
                </th>
                <td>{video.category || "—"}</td>
                <td>{video.duration === null ? "—" : formatDuration(video.duration)}</td>
                <td>{qualityLabel(video.height) || "—"}</td>
                <td>{formatText(video)}</td>
                <td className={compat && !compat.ok ? styles.tableBad : undefined}>
                  {compat?.label ?? "—"}
                </td>
                <td>{stateText(video)}</td>
                <td>{video.publicLink === null ? "No" : "Sì"}</td>
                <td>
                  <Link
                    to={`/admin/video/${video.id}`}
                    className={`glass ${styles.action} ${styles.small}`}
                    aria-label={`Modifica ${video.title}`}
                  >
                    Modifica
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// formatText is the kind of file and what is inside it: "MP4 · h264 · aac".
function formatText(video: AdminVideo): string {
  return (
    [video.format, video.videoCodec, video.audioCodec].filter((x) => x !== "").join(" · ") || "—"
  );
}

function stateText(video: AdminVideo): string {
  if (video.missing) return "Non trovato";
  if (video.hidden) return "Nascosto";
  if (video.tooShort) return "Troppo corto";
  if (video.duration === null) return "Da leggere";
  return "Visibile";
}
