import { useEffect, useState } from "react";
import { fetchLogins, type Login, type Outcome } from "../../api/logins";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import styles from "./Admin.module.css";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; logins: Login[]; more: boolean };

const outcomes: Record<Outcome, string> = {
  entered: "Entrato",
  wrong_password: "Password sbagliata",
  locked: "Bloccato: troppi tentativi",
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
    <>
      <div className={styles.top}>
        <p className={styles.lead}>
          Chi ha provato a entrare negli ultimi 90 giorni, quando e da quale indirizzo. Tante
          password sbagliate di seguito possono voler dire che qualcuno prova a indovinarle.
        </p>
      </div>
      <div className={styles.tools}>
        <search className={styles.searchForm}>
          <label className={`glass ${styles.searchBox}`}>
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
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(e) => setOnlyFailed(e.target.checked)}
          />
          Solo tentativi sbagliati
        </label>
      </div>
      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "error" && (
        <EmptyState title="Registro non disponibile">
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      )}
      {state.kind === "ready" && state.logins.length === 0 && (
        <EmptyState title={filtering ? "Nessun accesso trovato" : "Ancora nessun accesso"}>
          {filtering
            ? "Prova a cercare un'altra parola o togli il filtro."
            : "Quando qualcuno entra con nome e password, compare qui."}
        </EmptyState>
      )}
      {state.kind === "ready" && state.logins.length > 0 && (
        <>
          <ul className={`stagger ${styles.list}`} aria-label="Accessi">
            {state.logins.map((l) => (
              <li key={l.id} className={`glass ${styles.person}`}>
                <div>
                  <p className={styles.name}>{l.name || "(nessun nome)"}</p>
                  <p className={styles.role}>
                    {when.format(l.at)} · da {l.address}
                  </p>
                </div>
                <span className={l.outcome === "entered" ? styles.badgeOk : styles.badge}>
                  {outcomes[l.outcome]}
                </span>
              </li>
            ))}
          </ul>
          {state.more && (
            <button
              type="button"
              className={`glass ${styles.action} ${styles.more}`}
              disabled={loadingMore}
              onClick={more}
            >
              Mostra altri
            </button>
          )}
        </>
      )}
    </>
  );
}
