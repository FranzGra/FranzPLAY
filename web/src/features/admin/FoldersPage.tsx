import { useCallback, useEffect, useState } from "react";
import { onServerEvent } from "../../api/events";
import {
  fetchLibrary,
  type LastScan,
  type LibraryFolder,
  type LibraryOverview,
  scanLibrary,
} from "../../api/library";
import { EmptyState } from "../../components/EmptyState";
import { formatSince } from "../../lib/format";
import styles from "./Admin.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; library: LibraryOverview };

// FoldersPage shows the video folders FranzPLAY reads, how many videos
// each has, whether something is wrong with them, and how the last check
// went. The administrator can ask for a check right away.
export function FoldersPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [asked, setAsked] = useState(false);
  const [problem, setProblem] = useState("");

  const load = useCallback((signal?: AbortSignal) => {
    fetchLibrary(signal)
      .then((library) => setState({ kind: "ready", library }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        console.error(error);
        setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const refresh = () => load(controller.signal);
    const stopScan = onServerEvent("scan", refresh);
    const stopLibrary = onServerEvent("library", refresh);
    return () => {
      stopScan();
      stopLibrary();
      controller.abort();
    };
  }, [load]);

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Cartelle non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  const { library } = state;

  const scanNow = () => {
    setProblem("");
    setAsked(true);
    scanLibrary()
      .then(() => load())
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non sono riuscito a chiedere il controllo. Riprova tra poco.");
      })
      .finally(() => setAsked(false));
  };

  if (library.folders.length === 0) {
    return (
      <EmptyState title="Nessuna cartella video">
        Scrivi le cartelle dei tuoi video nell'impostazione FRANZPLAY_LIBRARIES e riavvia FranzPLAY:
        compariranno qui.
      </EmptyState>
    );
  }

  const busy = library.scanning || asked;
  return (
    <>
      <div className={styles.top}>
        <p className={styles.lead}>
          FranzPLAY legge queste cartelle e non le modifica mai. Le controlla da solo{" "}
          {every(library.interval)}. Per aggiungerne o toglierne una, cambia l'impostazione
          FRANZPLAY_LIBRARIES e riavvia FranzPLAY.
        </p>
        <button type="button" className={styles.primary} disabled={busy} onClick={scanNow}>
          {busy ? "Controllo in corso…" : "Controlla adesso"}
        </button>
      </div>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}

      <ul className={`stagger ${styles.list}`} aria-label="Cartelle video">
        {library.folders.map((folder) => (
          <li key={folder.path}>
            <Folder folder={folder} />
          </li>
        ))}
      </ul>

      {library.lastScan && <LastCheck scan={library.lastScan} />}
    </>
  );
}

function every(seconds: number): string {
  if (seconds === 60) return "ogni minuto";
  if (seconds % 60 === 0) return `ogni ${seconds / 60} minuti`;
  return `ogni ${seconds} secondi`;
}

function Folder({ folder }: { folder: LibraryFolder }) {
  return (
    <div className={`glass ${styles.person}`}>
      <div className={styles.failed}>
        <p className={`${styles.name} ${styles.path}`}>{folder.path}</p>
        <p className={styles.role}>
          {folder.videos.toLocaleString("it-IT")} video
          {folder.missing > 0 &&
            ` · ${folder.missing.toLocaleString("it-IT")} ${folder.missing === 1 ? "non trovato" : "non trovati"}`}
        </p>
        {folder.problem && (
          <>
            <p className={styles.bad}>
              Non riesco a leggere tutta la cartella: finché non si risolve, nessun suo video viene
              segnato come mancante.
            </p>
            <p className={styles.error}>{folder.problem}</p>
          </>
        )}
        {folder.looksUnplugged && (
          <p className={styles.bad}>
            La cartella è vuota ma aveva dei video: il disco è collegato? Intanto nessun video viene
            segnato come mancante.
          </p>
        )}
        {folder.missing > 0 && !folder.problem && !folder.looksUnplugged && (
          <p className={styles.role}>
            I video non trovati restano nel catalogo, con i loro mi piace e commenti, per 30 giorni:
            se tornano, si ritrova tutto.
          </p>
        )}
      </div>
      {!folder.problem && !folder.looksUnplugged && (
        <span className={styles.good}>Tutto a posto</span>
      )}
    </div>
  );
}

const changeNames: [keyof LastScan, string, string][] = [
  ["added", "nuovo", "nuovi"],
  ["moved", "spostato", "spostati"],
  ["updated", "cambiato", "cambiati"],
  ["restored", "ritrovato", "ritrovati"],
  ["missing", "non trovato", "non trovati"],
  ["forgotten", "dimenticato", "dimenticati"],
  ["duplicates", "doppione ignorato", "doppioni ignorati"],
  ["problems", "problema", "problemi"],
];

// describeChanges says in words what one check found.
export function describeChanges(scan: LastScan): string {
  const parts = changeNames
    .filter(([key]) => (scan[key] as number) > 0)
    .map(([key, one, many]) => {
      const n = scan[key] as number;
      return `${n.toLocaleString("it-IT")} ${n === 1 ? one : many}`;
    });
  return parts.length === 0 ? "nessun cambiamento" : parts.join(" · ");
}

// took says how long a check lasted.
export function took(seconds: number): string {
  if (seconds < 1) return "in meno di un secondo";
  const n = Math.round(seconds);
  return n === 1 ? "in un secondo" : `in ${n} secondi`;
}

function LastCheck({ scan }: { scan: LastScan }) {
  return (
    <section className={`glass ${styles.stat} ${styles.lastCheck}`} aria-label="Ultimo controllo">
      <p className={styles.role}>
        Ultimo controllo {formatSince(scan.at, new Date())}, {took(scan.seconds)}
      </p>
      {scan.error ? (
        <p className={styles.bad}>Il controllo non è riuscito: {scan.error}</p>
      ) : (
        <p className={styles.name}>{describeChanges(scan)}</p>
      )}
    </section>
  );
}
