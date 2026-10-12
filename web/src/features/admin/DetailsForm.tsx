import { type FormEvent, useState } from "react";
import { type AdminVideo, maxCategory, maxTitle, setVideoDetails } from "../../api/adminVideos";
import styles from "./Admin.module.css";

// DetailsForm changes the title and category of a video. Only what
// FranzPLAY shows changes: the file keeps its name and its folder. The
// ones found by FranzPLAY can always be put back.
export function DetailsForm({
  video,
  onSaved,
  onCancel,
}: {
  video: AdminVideo;
  onSaved: (video: AdminVideo) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [category, setCategory] = useState(video.category);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    const t = title.trim();
    const c = category.trim();
    if (t === "" || [...t].length > maxTitle) {
      setProblem(`Il titolo deve avere da 1 a ${maxTitle} caratteri.`);
      return;
    }
    if ([...c].length > maxCategory) {
      setProblem(`La categoria può avere al massimo ${maxCategory} caratteri.`);
      return;
    }
    // Writing back exactly what was found means "as found": it then
    // follows the file again if it is renamed or moved.
    const details = {
      title: t === video.foundTitle ? null : t,
      category: c === video.foundCategory ? null : c,
    };
    setBusy(true);
    setProblem("");
    setVideoDetails(video.id, details)
      .then(() =>
        onSaved({
          ...video,
          title: t,
          category: c,
          titleSet: details.title !== null,
          categorySet: details.category !== null,
        }),
      )
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
        setBusy(false);
      });
  };

  return (
    <form className={styles.inline} onSubmit={send} aria-label={`Modifica ${video.title}`}>
      <label className={styles.field}>
        Titolo
        <input value={title} maxLength={maxTitle} onChange={(e) => setTitle(e.target.value)} />
        {title.trim() !== video.foundTitle && (
          <span>
            Trovato da FranzPLAY: «{video.foundTitle}».{" "}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setTitle(video.foundTitle)}
            >
              Rimetti questo
            </button>
          </span>
        )}
      </label>
      <label className={styles.field}>
        Categoria
        <input
          value={category}
          maxLength={maxCategory}
          list="admin-categories"
          placeholder="Nessuna categoria"
          onChange={(e) => setCategory(e.target.value)}
        />
        {category.trim() !== video.foundCategory && (
          <span>
            {video.foundCategory
              ? `Dalla cartella: «${video.foundCategory}». `
              : "Dalla cartella: nessuna. "}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setCategory(video.foundCategory)}
            >
              Rimetti questa
            </button>
          </span>
        )}
      </label>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      <div className={styles.buttons}>
        <button type="button" className={`glass ${styles.action}`} onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className={styles.primary} disabled={busy}>
          Salva
        </button>
      </div>
    </form>
  );
}
