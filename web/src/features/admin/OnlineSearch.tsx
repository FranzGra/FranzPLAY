import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import {
  type Candidate,
  fetchPicture,
  fetchSources,
  type KeySource,
  type OnlineStatus,
  pictureURL,
  type SearchAnswer,
  type SearchProblem,
  searchOnline,
} from "../../api/online";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import pages from "./Pages.module.css";
import { Chip, ui } from "./ui";

const sourceNames: Record<KeySource, string> = { tmdb: "TMDB (film)", tpdb: "ThePornDB" };

// readySources are the sources that can be searched: turned on, with a key.
function readySources(status: OnlineStatus): KeySource[] {
  const ready: KeySource[] = [];
  if (status.tmdb && status.tmdbKey) ready.push("tmdb");
  if (status.tpdb && status.tpdbKey) ready.push("tpdb");
  return ready;
}

// OnlineSearch lets the administrator search the sources on the internet,
// all of them or one, with words of their choice, and pick one of the
// pictures found. The picture then goes through the same cut as an uploaded
// one. What was found opens in resultsIn, a place as wide as the whole box,
// so the pictures can be judged at a glance. A search starts only from the
// button: every search is a question to the sources.
export function OnlineSearch({
  title,
  busy,
  onPick,
  resultsIn,
}: {
  title: string;
  busy: boolean;
  onPick: (picture: Blob) => void;
  resultsIn: HTMLElement | null;
}) {
  const [sources, setSources] = useState<KeySource[] | null>(null);
  const [source, setSource] = useState<KeySource | "all">("all");
  const [words, setWords] = useState(title);
  const [found, setFound] = useState<SearchAnswer | null>(null);
  const [work, setWork] = useState<"search" | "pick" | null>(null);
  const [problem, setProblem] = useState("");
  const asking = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSources(controller.signal)
      .then((status) => {
        const ready = readySources(status);
        setSources(ready);
        setSource(ready.length === 1 && ready[0] ? ready[0] : "all");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setSources([]);
        setProblem("Non si riesce a sapere quali fonti sono accese. Riprova tra poco.");
      });
    return () => {
      controller.abort();
      asking.current?.abort();
    };
  }, []);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const text = words.trim();
    if (text === "" || work !== null) return;
    const controller = new AbortController();
    asking.current = controller;
    setWork("search");
    setProblem("");
    searchOnline(source, text, title, controller.signal)
      .then(setFound)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setFound(null);
        setProblem(problemText(error, source));
      })
      .finally(() => {
        if (!controller.signal.aborted) setWork(null);
      });
  };

  const pick = (candidate: Candidate) => {
    setWork("pick");
    setProblem("");
    fetchPicture(candidate.source, candidate.picture)
      .then(onPick)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Questa immagine non è arrivata. Prova con un'altra.");
      })
      .finally(() => setWork(null));
  };

  if (sources === null) {
    return <p className={ui.hint}>Un momento…</p>;
  }
  if (sources.length === 0) {
    return problem ? (
      <p className={ui.cardText}>{problem}</p>
    ) : (
      <div className={pages.noSources}>
        <p className={ui.cardText}>
          Nessuna fonte è pronta. Per cercare su internet accendi TMDB o ThePornDB, con la loro
          chiave.
        </p>
        <Link to="/admin/internet" className={ui.btn}>
          <Icon name="globe" size={16} />
          Apri Amministrazione › Internet
        </Link>
      </div>
    );
  }

  const results = found && (
    <Results
      found={found}
      asked={source === "all" ? sources.length : 1}
      title={title}
      disabled={busy || work !== null}
      onPick={pick}
    />
  );

  return (
    <div className={pages.onlineSearch}>
      <form className={pages.searchForm} onSubmit={search}>
        {sources.length > 1 ? (
          <div className={ui.field}>
            <span className={ui.label}>Dove cercare</span>
            <Select<KeySource | "all">
              aria-label="Dove cercare"
              value={source}
              options={[
                { value: "all", label: `Tutte le fonti (${sources.length})` },
                ...sources.map((s) => ({ value: s, label: sourceNames[s] })),
              ]}
              onChange={(s) => {
                setSource(s);
                setFound(null);
                setProblem("");
              }}
            />
          </div>
        ) : null}
        <label className={ui.field}>
          <span className={ui.label}>Cosa cercare</span>
          <input
            className={ui.input}
            type="search"
            value={words}
            maxLength={200}
            onChange={(e) => setWords(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className={`${ui.btn} ${ui.primary}`}
          disabled={busy || work !== null || words.trim() === ""}
        >
          <Icon name="search" size={16} />
          {work === "search" ? "Cerco…" : "Cerca"}
        </button>
      </form>
      {sources.length === 1 && sources[0] && (
        <p className={ui.hint}>
          Cerca in <b>{sourceNames[sources[0]]}</b>, l'unica fonte pronta.
        </p>
      )}
      {work === "pick" && (
        <p role="status" className={ui.hint}>
          Scarico l'immagine scelta…
        </p>
      )}
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
      {resultsIn ? results && createPortal(results, resultsIn) : results}
    </div>
  );
}

// Results is what a search found, from the best match, and the sources that
// gave nothing because of a problem.
function Results({
  found,
  asked,
  title,
  disabled,
  onPick,
}: {
  found: SearchAnswer;
  asked: number;
  title: string;
  disabled: boolean;
  onPick: (candidate: Candidate) => void;
}) {
  const { results, problems } = found;
  const nothing = results.length === 0;
  let lines: ReactNode = null;
  if (problems.length > 0) {
    const text = problems.map(sourceProblemText).join(" ");
    lines =
      nothing && problems.length >= asked ? (
        <p role="alert" className={ui.problem}>
          {text}
        </p>
      ) : (
        <p role="status" className={pages.foundProblems}>
          <Icon name="alert" size={14} />
          {text}
        </p>
      );
  }
  return (
    <div className={pages.foundBox}>
      {lines}
      {nothing && problems.length < asked && (
        <p role="status" className={ui.hint}>
          {problems.length > 0
            ? "Nessun risultato dalle altre fonti. Prova con altre parole."
            : "Nessun risultato. Prova con altre parole."}
        </p>
      )}
      {!nothing && (
        <>
          <p role="status" className={ui.hint}>
            {results.length === 1 ? "Un risultato" : `${results.length} risultati, dal più simile`}.
            La percentuale dice quante parole del titolo trovato sono uguali a quelle del titolo del
            video, «{title}». Non guarda l'immagine.
          </p>
          <ul className={pages.found} aria-label="Immagini trovate">
            {results.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: answers have no code of their own
              <li key={i}>
                <button
                  type="button"
                  className={pages.foundItem}
                  disabled={disabled || c.picture === ""}
                  onClick={() => onPick(c)}
                >
                  <span className={pages.foundPicture}>
                    {c.thumb ? (
                      <img src={pictureURL(c.source, c.thumb)} alt="" loading="lazy" />
                    ) : (
                      <span className={pages.noPicture}>Senza immagine</span>
                    )}
                  </span>
                  <span className={pages.foundChips}>
                    <Chip tone={matchTone(c.match)}>
                      {c.match}% · {matchWords(c.match)}
                    </Chip>
                    <Chip icon="globe">{c.sourceName}</Chip>
                  </span>
                  <span className={pages.foundTitle}>{c.title}</span>
                  <span className={pages.foundMeta}>
                    {[c.date.slice(0, 4), c.author].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// matchWords says the percentage in words: of the title, never of the picture.
export function matchWords(match: number): string {
  if (match === 100) return "stesse parole";
  if (match >= 70) return "molto simile";
  if (match >= 40) return "in parte";
  if (match > 0) return "poco simile";
  return "titolo diverso";
}

function matchTone(match: number): "ok" | "warn" | undefined {
  if (match >= 70) return "ok";
  if (match >= 40) return "warn";
  return undefined;
}

function sourceProblemText({ sourceName, kind }: SearchProblem): string {
  return kind === "key"
    ? `${sourceName} non accetta più la chiave: salvane una nuova in Amministrazione › Internet.`
    : `${sourceName} non risponde: riprova tra poco.`;
}

function problemText(error: unknown, source: KeySource | "all"): string {
  const name = source === "tmdb" ? "TMDB" : source === "tpdb" ? "ThePornDB" : "La fonte";
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
