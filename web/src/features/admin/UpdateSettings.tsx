import { useEffect, useState } from "react";
import { fetchUpdates, saveUpdateCheck, type Updates } from "../../api/updates";
import pages from "./Pages.module.css";
import { Card, Chip, Loading, SettingSwitch, Unavailable, ui } from "./ui";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; updates: Updates };

// formatWhen writes a date and time the Italian way.
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
}

// installedText says which FranzPLAY is running: the release, or the commit
// of a development build.
export function installedText(u: Updates): string {
  if (u.development) return `versione di sviluppo (${u.commit || "sconosciuta"})`;
  return u.release;
}

// UpdateSettings shows the installed version and whether FranzPLAY checks
// for new ones once a day.
export function UpdateSettings() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchUpdates(controller.signal)
      .then((updates) => setState({ kind: "ready", updates }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") return <Loading />;
  if (state.kind === "error") return <Unavailable title="Versione non disponibile" />;

  const change = (enabled: boolean) => {
    setBusy(true);
    setProblem("");
    return saveUpdateCheck(enabled)
      .then((updates) => setState({ kind: "ready", updates }))
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  const u = state.updates;
  const latest = u.latest || (u.checkedAt ? "nessuna pubblicata" : "non ancora controllata");
  return (
    <Card
      title="Aggiornamenti"
      icon="refresh"
      sub={u.newer ? <Chip tone="info">Nuova versione</Chip> : undefined}
    >
      <SettingSwitch
        label="Controlla automaticamente le nuove versioni"
        hint="Una volta al giorno FranzPLAY chiede a GitHub qual è l'ultima versione ufficiale. A GitHub arriva solo la richiesta, nessun dato dei tuoi video o delle persone. FranzPLAY non si aggiorna da solo: ti avvisa e ti dice come fare."
        checked={u.enabled}
        disabled={busy}
        onChange={change}
      />
      <dl className={`${ui.kv} ${pages.block}`}>
        <dt>Versione installata</dt>
        <dd>
          <strong>{installedText(u)}</strong>
        </dd>
        {u.enabled && (
          <>
            <dt>Ultima ufficiale</dt>
            <dd>
              <strong>{latest}</strong>
              {u.latest && u.url && (
                <>
                  {" · "}
                  <a className={ui.link} href={u.url} target="_blank" rel="noreferrer">
                    note di rilascio
                  </a>
                </>
              )}
            </dd>
            <dt>Ultimo controllo</dt>
            <dd>{u.checkedAt ? formatWhen(u.checkedAt) : "non ancora fatto"}</dd>
          </>
        )}
      </dl>
      {u.enabled && u.newer && (
        <p className={ui.okText} role="status">
          È disponibile la versione {u.latest}.
        </p>
      )}
      {u.enabled && u.development && u.latest && (
        <p className={ui.hint}>
          Questa è una versione di sviluppo: non si può confrontare con le versioni ufficiali,
          quindi FranzPLAY non propone aggiornamenti.
        </p>
      )}
      {!u.enabled && <p className={ui.hint}>Spento: GitHub non viene mai contattato.</p>}
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </Card>
  );
}
