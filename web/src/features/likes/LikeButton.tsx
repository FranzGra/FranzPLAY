import { useEffect, useState } from "react";
import { fetchLike, type Like, setLike } from "../../api/likes";
import { Icon } from "../../components/Icon";
import styles from "./LikeButton.module.css";

// LikeButton shows how many people like a video and lets me like it.
// It changes at once and goes back if the server refuses.
export function LikeButton({ videoId }: { videoId: number }) {
  const [like, setLikeState] = useState<Like | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLikeState(null);
    fetchLike(videoId, controller.signal)
      .then(setLikeState)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [videoId]);

  // Without the like the video is still fine to watch: no button.
  if (like === null) return null;

  const toggle = () => {
    const before = like;
    const liked = !before.liked;
    setLikeState({ liked, count: Math.max(0, before.count + (liked ? 1 : -1)) });
    setSaving(true);
    setFailed(false);
    setLike(videoId, liked)
      .then(setLikeState)
      .catch((error: unknown) => {
        console.error(error);
        setLikeState(before);
        setFailed(true);
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={`glass ${styles.button}`}
        aria-pressed={like.liked}
        disabled={saving}
        onClick={toggle}
        title={like.liked ? "Non mi piace più" : "Mi piace"}
      >
        <Icon name="like" size={20} />
        Mi piace
        {like.count > 0 && (
          <span className={styles.count} aria-hidden="true">
            {like.count.toLocaleString("it-IT")}
          </span>
        )}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {like.count === 1 ? "Piace a 1 persona" : `Piace a ${like.count} persone`}
      </span>
      {failed && (
        <span role="alert" className={styles.problem}>
          Non sono riuscito a salvare il like. Riprova.
        </span>
      )}
    </div>
  );
}
