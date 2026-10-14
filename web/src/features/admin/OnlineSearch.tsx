import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import {
  type Candidate,
  fetchPicture,
  fetchSources,
  type KeySource,
  type OnlineStatus,
  pictureURL,
  searchOnline,
} from "../../api/online";
import styles from "./Admin.module.css";

const sourceNames: Record<KeySource, string> = { tmdb: "TMDB (film)", tpdb: "ThePornDB" };

// readySources are the sources that can be searched: turned on, with a key.
function readySources(status: OnlineStatus): KeySource[] {
  const ready: KeySource[] = [];
  if (status.tmdb && status.tmdbKey) ready.push("tmdb");
  if (status.tpdb && status.tpdbKey) ready.push("tpdb");
  return ready;
}

// OnlineSearch lets the administrator search a source on the internet
// with words of their choice, and pick one of the pictures found. The
// picture then goes through the same cut as an uploaded one.
export function OnlineSearch({
  title,
  busy,
  onPick,
}: {
  title: string;
  busy: boolean;
  onPick: (picture: Blob) => void;
}) {
  const [sources, setSources] = useState<KeySource[] | null>(null);
  const [source, setSource] = useState<KeySource>("tmdb");
  const [words, setWords] = useState(title);
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchSources(controller.signal)
      .then((status) => {
        const ready = readySources(status);
        setSources(ready);
        if (ready[0]) setSource(ready[0]);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setSources([]);
        setProblem("Non si riesce a sapere quali fonti sono accese. Riprova tra poco.");
      });
    return () => controller.abort();
  }, []);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const text = words.trim();
    if (text === "") return;
    setSearching(true);
    setProblem("");
    searchOnline(source, text)
      .then(setFound)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(problemText(error, source));
      })
      .finally(() => setSearching(false));
  };

  const pick = (candidate: Candidate) => {
    setSearching(true);
    setProblem("");
    fetchPicture(source, candidate.picture)
      .then(onPick)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Questa immagine non è arrivata. Prova con un'altra.");
      })
      .finally(() => setSearching(false));
  };

  if (sources === null) {
    return <p className={styles.coverNow}>Un momento…</p>;
  }
  if (sources.length === 0) {
    return (
      <p className={styles.coverNow}>
        {problem ||
          "Per cercare su internet accendi TMDB o ThePornDB in Amministrazione › Internet, con la loro chiave."}
      </p>
    );
  }
  return (
    <div className={styles.coverSearch}>
      <form className={styles.momentControls} onSubmit={search}>
        {sources.length > 1 && (
          <label className={styles.field}>
            Dove cercare
            <select
              className={`glass ${styles.select}`}
              value={source}
              onChange={(e) => {
                setSource(e.target.value as KeySource);
                setFound(null);
              }}
            >
              {sources.map((s) => (
                <option key={s} value={s}>
                  {sourceNames[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.field}>
          Cosa cercare
          <input
            type="search"
            value={words}
            maxLength={200}
            onChange={(e) => setWords(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className={styles.primary}
          disabled={busy || searching || words.trim() === ""}
        >
          Cerca
        </button>
      </form>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {found && found.length === 0 && (
        <p className={styles.coverNow}>Nessun risultato. Prova con altre parole.</p>
      )}
      {found && found.length > 0 && (
        <ul className={styles.found} aria-label="Immagini trovate">
          {found.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: answers have no code of their own
            <li key={i}>
              <button
                type="button"
                className={`glass ${styles.foundItem}`}
                disabled={busy || searching || c.picture === ""}
                onClick={() => pick(c)}
              >
                {c.thumb ? (
                  <img src={pictureURL(source, c.thumb)} alt="" loading="lazy" />
                ) : (
                  <span className={styles.noPicture}>Senza immagine</span>
                )}
                <span className={styles.foundTitle}>{c.title}</span>
                <span className={styles.foundMeta}>
                  {[c.date.slice(0, 4), c.author].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function problemText(error: unknown, source: KeySource): string {
  const name = source === "tmdb" ? "TMDB" : "ThePornDB";
  if (error instanceof ApiError) {
    switch (error.status) {
      case 409:
        return `${name} è spento: accendilo in Amministrazione › Internet.`;
      case 422:
        return `${name} non accetta più la chiave: salvane una nuova in Amministrazione › Internet.`;
      case 502:
        return `${name} non risponde. Riprova tra poco.`;
    }
  }
  return "La ricerca non è riuscita. Riprova tra poco.";
}
