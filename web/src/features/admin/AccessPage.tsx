import { useEffect, useState } from "react";
import {
  type Block,
  fetchBlocks,
  fetchLogins,
  type Login,
  type Outcome,
  unblock,
} from "../../api/logins";
import { Icon } from "../../components/Icon";
import pages from "./Pages.module.css";
import { Card, Chip, Empty, Loading, PageHeader, type Tone, Unavailable, ui } from "./ui";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; logins: Login[]; more: boolean };

const outcomes: Record<Outcome, string> = {
  entered: "Entrato",
  wrong_password: "Accesso sbagliato",
  locked: "Bloccato: troppi tentativi",
};

const outcomeTones: Record<Outcome, Tone> = {
  entered: "ok",
  wrong_password: "warn",
  locked: "bad",
};

const when = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });

// AccessPage is the access log: every try to log in of the last 90 days,
// the newest first, so the administrator sees who entered and notices if
// someone is guessing passwords.
export function AccessPage() {
  const [search, setSearch] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    // Typing a search waits a moment, so not every letter asks the server.
    const timer = setTimeout(() => {
      fetchLogins({ search, onlyFailed }, controller.signal)
        .then((page) => setState({ kind: "ready", ...page }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.error(error);
          setState({ kind: "error" });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, onlyFailed]);

  const more = () => {
    if (state.kind !== "ready") return;
    setLoadingMore(true);
    fetchLogins({ search, onlyFailed, before: state.logins.at(-1)?.id })
      .then((page) =>
        setState((s) =>
          s.kind === "ready"
            ? { kind: "ready", logins: [...s.logins, ...page.logins], more: page.more }
            : s,
        ),
      )
      .catch((error: unknown) => {
        console.error(error);
        setState({ kind: "error" });
      })
      .finally(() => setLoadingMore(false));
  };

  const filtering = search.trim() !== "" || onlyFailed;
  return (
    <div className={ui.ui}>
      <PageHeader
        title="Accessi"
        description="Chi ha provato a entrare negli ultimi 90 giorni, quando e da quale indirizzo. Tante password, PIN o sequenze sbagliate di seguito possono voler dire che qualcuno prova a indovinarle: FranzPLAY allora blocca per un po' quel nome e quell'indirizzo."
      />
      <Blocks />
      <div className={ui.toolbar}>
        <search className={ui.search}>
          <label className={ui.searchBox}>
            <Icon name="search" size={18} />
            <span className="visually-hidden">Cerca un nome o un indirizzo</span>
            <input
              type="search"
              placeholder="Nome o indirizzo"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </search>
        <label className={pages.check}>
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(e) => setOnlyFailed(e.target.checked)}
          />
          Solo tentativi sbagliati
        </label>
      </div>
      {state.kind === "loading" && <Loading />}
      {state.kind === "error" && <Unavailable title="Registro non disponibile" />}
      {state.kind === "ready" && state.logins.length === 0 && (
        <Empty
          icon={filtering ? "search" : "key"}
          title={filtering ? "Nessun accesso trovato" : "Ancora nessun accesso"}
        >
          {filtering
            ? "Prova a cercare un'altra parola o togli il filtro."
            : "Quando qualcuno entra con nome e password, compare qui."}
        </Empty>
      )}
      {state.kind === "ready" && state.logins.length > 0 && (
        <Card label="Registro degli accessi">
          <div className={pages.logHead} aria-hidden="true">
            <span>Persona</span>
            <span>Quando</span>
            <span>Da dove</span>
            <span>Esito</span>
          </div>
          <ul className={pages.log} aria-label="Accessi">
            {state.logins.map((l) => (
              <li key={l.id} className={pages.logRow} data-outcome={l.outcome}>
                <b className={pages.logName}>{l.name || "(nessun nome)"}</b>
                <span className={pages.logWhen}>{when.format(l.at)}</span>
                <span className={`${pages.logWhere} ${ui.mono}`}>
                  <span className="visually-hidden">da </span>
                  {l.address}
                </span>
                <span className={pages.logOutcome}>
                  <Chip tone={outcomeTones[l.outcome]}>{outcomes[l.outcome]}</Chip>
                </span>
              </li>
            ))}
          </ul>
          {state.more && (
            <div className={pages.more}>
              <button type="button" className={ui.btn} disabled={loadingMore} onClick={more}>
                Mostra altri
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const until = new Intl.DateTimeFormat("it-IT", { timeStyle: "short" });

// Blocks lists the names and addresses blocked now, after too many wrong
// tries, and lets the administrator lift a block at once.
function Blocks() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchBlocks(controller.signal)
      .then(setBlocks)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setProblem("Non si riesce a leggere i blocchi attivi. Ricarica la pagina tra poco.");
      });
    return () => controller.abort();
  }, []);

  const lift = (key: string) => {
    setBusy(key);
    setProblem("");
    unblock(key)
      .then(() => setBlocks((list) => list.filter((b) => b.key !== key)))
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Sblocco non riuscito. Riprova tra poco.");
      })
      .finally(() => setBusy(""));
  };

  if (blocks.length === 0 && !problem) return null;
  return (
    <section className={pages.blocks} aria-label="Bloccati adesso">
      <Card title="Bloccati adesso" icon="lock" titleTag="h2" className={pages.blocksCard}>
        {problem && (
          <p role="alert" className={ui.problem}>
            {problem}
          </p>
        )}
        <ul className={ui.rows}>
          {blocks.map((b) => (
            <li key={b.key} className={ui.row}>
              <span className={pages.rowIcon} data-tone="bad" aria-hidden="true">
                <Icon name="lock" size={18} />
              </span>
              <div className={ui.rowMain}>
                <b>{b.kind === "account" ? `Nome «${b.value}»` : `Indirizzo ${b.value}`}</b>
                <span>
                  Fino alle {until.format(b.until)}
                  {b.level > 1 && ` · ${b.level}° blocco di seguito`}
                </span>
              </div>
              <div className={ui.rowSide}>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.small}`}
                  disabled={busy === b.key}
                  onClick={() => lift(b.key)}
                >
                  Sblocca
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
