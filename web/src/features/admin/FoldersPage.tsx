import { type ReactNode, useCallback, useEffect, useState } from "react";
import { onServerEvent } from "../../api/events";
import {
  fetchLibrary,
  type LastScan,
  type LibraryFolder,
  type LibraryOverview,
  scanLibrary,
} from "../../api/library";
import { Icon } from "../../components/Icon";
import { BusyRing } from "../../components/ProgressBar";
import { formatSince } from "../../lib/format";
import pages from "./Pages.module.css";
import { ShortVideosForm } from "./ShortVideosForm";
import { Card, Chip, Empty, Loading, PageHeader, Unavailable, ui } from "./ui";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; library: LibraryOverview };

// FoldersPage shows the video folders FranzPLAY reads, how many videos
// each has, whether something is wrong with them, and how the last check
// went. The administrator can ask for a check right away, and leave out
// the videos too short to be worth showing.
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

  const head = (actions?: ReactNode, description?: string) => (
    <PageHeader
      title="Cartelle"
      description={
        description ??
        "FranzPLAY legge queste cartelle e non le modifica mai. Per aggiungerne o toglierne una, cambia l'impostazione FRANZPLAY_LIBRARIES e riavvia FranzPLAY."
      }
      actions={actions}
    />
  );
  if (state.kind === "loading") {
    return (
      <div className={ui.ui}>
        {head()}
        <Loading />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={ui.ui}>
        {head()}
        <Unavailable title="Cartelle non disponibili" />
      </div>
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
      <div className={ui.ui}>
        {head()}
        <Empty icon="folder" title="Nessuna cartella video">
          Scrivi le cartelle dei tuoi video nell'impostazione FRANZPLAY_LIBRARIES e riavvia
          FranzPLAY: compariranno qui.
        </Empty>
      </div>
    );
  }

  const busy = library.scanning || asked;
  const videos = library.folders.reduce((sum, f) => sum + f.videos, 0);
  return (
    <div className={ui.ui}>
      {head(
        <button
          type="button"
          className={`${ui.btn} ${ui.primary}`}
          disabled={busy}
          onClick={scanNow}
        >
          {busy ? <BusyRing size={16} /> : <Icon name="refresh" size={16} />}
          {busy ? "Controllo in corso…" : "Controlla adesso"}
        </button>,
        `FranzPLAY legge queste cartelle e non le modifica mai. Le controlla da solo ${every(library.interval)}. Per aggiungerne o toglierne una, cambia l'impostazione FRANZPLAY_LIBRARIES e riavvia FranzPLAY.`,
      )}
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}

      <div className={ui.grid}>
        <div className={`${ui.span8} ${ui.stack}`}>
          <Card
            title="Cartelle video"
            icon="folder"
            sub={`${library.folders.length} ${library.folders.length === 1 ? "cartella" : "cartelle"} · ${videos.toLocaleString("it-IT")} video`}
          >
            <ul className={ui.rows} aria-label="Cartelle video">
              {library.folders.map((folder) => (
                <li key={folder.path}>
                  <Folder folder={folder} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className={`${ui.span4} ${ui.stack}`}>
          {library.lastScan && <LastCheck scan={library.lastScan} />}
          <ShortVideosForm
            key={library.minDuration}
            minDuration={library.minDuration}
            tooShort={library.tooShort}
            onSaved={() => load()}
          />
        </div>
      </div>
    </div>
  );
}

function every(seconds: number): string {
  if (seconds === 60) return "ogni minuto";
  if (seconds % 60 === 0) return `ogni ${seconds / 60} minuti`;
  return `ogni ${seconds} secondi`;
}

function Folder({ folder }: { folder: LibraryFolder }) {
  const fine = !folder.problem && !folder.looksUnplugged;
  return (
    <div className={`${ui.row} ${pages.folder}`}>
      <span className={pages.rowIcon} data-tone={fine ? "ok" : "bad"} aria-hidden="true">
        <Icon name={fine ? "folder" : "alert"} size={18} />
      </span>
      <div className={ui.rowMain}>
        <b className={ui.mono}>{folder.path}</b>
        <span>
          {folder.videos.toLocaleString("it-IT")} video
          {folder.missing > 0 &&
            ` · ${folder.missing.toLocaleString("it-IT")} ${folder.missing === 1 ? "non trovato" : "non trovati"}`}
        </span>
        {folder.problem && (
          <>
            <p className={ui.problem}>
              Non riesco a leggere tutta la cartella: finché non si risolve, nessun suo video viene
              segnato come mancante.
            </p>
            <p className={pages.errorText}>{folder.problem}</p>
          </>
        )}
        {folder.looksUnplugged && (
          <p className={ui.problem}>
            La cartella è vuota ma aveva dei video: il disco è collegato? Intanto nessun video viene
            segnato come mancante.
          </p>
        )}
        {folder.missing > 0 && fine && (
          <p className={ui.hint}>
            I video non trovati restano nel catalogo, con i loro mi piace e commenti, per 30 giorni:
            se tornano, si ritrova tutto.
          </p>
        )}
      </div>
      <div className={ui.rowSide}>
        {fine ? (
          <Chip tone="ok" icon="check">
            Tutto a posto
          </Chip>
        ) : (
          <Chip tone="bad" icon="alert">
            Da controllare
          </Chip>
        )}
      </div>
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
    <Card title="Ultimo controllo" icon="clock">
      <p className={ui.cardText}>
        {formatSince(scan.at, new Date())}, {took(scan.seconds)}
      </p>
      {scan.error ? (
        <p className={ui.problem}>Il controllo non è riuscito: {scan.error}</p>
      ) : (
        <p className={pages.bigLine}>{describeChanges(scan)}</p>
      )}
    </Card>
  );
}
