import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { ApiError } from "../../api/client";
import {
  fetchSources,
  type KeySource,
  type OnlineSources,
  type OnlineStatus,
  saveKey,
  saveSources,
} from "../../api/online";
import { Icon } from "../../components/Icon";
import { OnlineProposals } from "./OnlineProposals";
import { OnlineRulesForm } from "./OnlineRules";
import pages from "./Pages.module.css";
import { Chip, Loading, PageHeader, Unavailable, ui } from "./ui";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; status: OnlineStatus };

// OnlinePage lets the administrator turn on the sources on the internet
// that give covers and details of the videos. FranzPLAY works the same
// with all of them off.
export function OnlinePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchSources(controller.signal)
      .then((status) => setState({ kind: "ready", status }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  const header = (
    <PageHeader
      title="Internet"
      description="FranzPLAY funziona anche senza internet. Se accendi una fonte, chiede copertine e informazioni dei video che riconosce. Manda solo quello che serve a trovarli (il codice del video, titolo e anno del film, o un'impronta del file), niente su di te o su chi usa FranzPLAY. Quello che c'è nei file accanto ai video conta sempre di più."
    />
  );
  if (state.kind === "loading") {
    return (
      <div className={ui.ui}>
        {header}
        <Loading />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={ui.ui}>
        {header}
        <Unavailable title="Impostazioni non disponibili" />
      </div>
    );
  }
  const before = state.status;

  const change = (next: OnlineSources) => {
    setBusy(true);
    setProblem("");
    setDone("");
    saveSources(next)
      .then((status) => {
        setState({ kind: "ready", status });
        const turnedOn =
          (status.youtube && !before.youtube) ||
          (status.tmdb && !before.tmdb) ||
          (status.tpdb && !before.tpdb);
        setDone(
          turnedOn
            ? "Acceso. FranzPLAY chiede un video alla volta: lo vedi in Lavori."
            : "Salvato.",
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  const keySaved = (status: OnlineStatus, source: KeySource, name: string) => {
    setState({ kind: "ready", status });
    setProblem("");
    setDone(
      status[source]
        ? "Chiave salvata. FranzPLAY chiede di nuovo un video alla volta: lo vedi in Lavori."
        : `Chiave salvata. Ora puoi accendere ${name}.`,
    );
  };

  return (
    <div className={ui.ui}>
      {header}
      {problem && (
        <p role="alert" className={`${ui.problem} ${pages.pageMessage}`}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={`${ui.okText} ${pages.pageMessage}`}>
          {done}
        </p>
      )}
      <div className={ui.grid}>
        <div className={ui.span7}>
          <ul className={pages.sources} aria-label="Fonti su internet">
            <Source
              name="YouTube"
              icon="play"
              on={before.youtube}
              disabled={busy}
              onChange={(on) => change({ ...before, youtube: on })}
            >
              <p>
                Per i video scaricati da YouTube, con il codice nel nome del file, come li salva
                yt-dlp: <code>Gita in montagna [dQw4w9WgXcQ].mp4</code>. Dà copertina, titolo e
                canale. Non serve nessuna chiave.
              </p>
            </Source>
            <Source
              name="TMDB"
              label="TMDB (film)"
              icon="film"
              on={before.tmdb}
              hasKey={before.tmdbKey}
              disabled={busy || !before.tmdbKey}
              onChange={(on) => change({ ...before, tmdb: on })}
              keyForm={
                <KeyForm source="tmdb" name="TMDB" hasKey={before.tmdbKey} onSaved={keySaved} />
              }
            >
              <p>
                Per i film con titolo e anno nel nome del file: <code>Il sorpasso (1962).mkv</code>{" "}
                oppure <code>The.Matrix.1999.1080p.mkv</code>. Dà immagine, titolo, trama, regista e
                data di uscita. Si usa solo un film con lo stesso titolo e lo stesso anno, così un
                video di famiglia non diventa un film a caso.
              </p>
              <p>
                Serve una chiave gratuita: crea un account su{" "}
                <a
                  className={ui.link}
                  href="https://www.themoviedb.org/settings/api"
                  target="_blank"
                  rel="noreferrer"
                >
                  themoviedb.org
                </a>{" "}
                e copia la «Chiave API» o il «Token di accesso in lettura».
              </p>
              <p className={pages.fine}>
                Questo prodotto usa l'API di TMDB ma non è approvato né certificato da TMDB.
              </p>
            </Source>
            <Source
              name="ThePornDB"
              icon="eye"
              on={before.tpdb}
              hasKey={before.tpdbKey}
              disabled={busy || !before.tpdbKey}
              onChange={(on) => change({ ...before, tpdb: on })}
              keyForm={
                <KeyForm
                  source="tpdb"
                  name="ThePornDB"
                  hasKey={before.tpdbKey}
                  onSaved={keySaved}
                />
              }
            >
              <p>
                Per qualsiasi video, di solito quelli né da YouTube né film. FranzPLAY calcola
                un'impronta del file (un numero che dipende solo dal suo contenuto) e manda solo
                quella. Si usa una scena solo se ThePornDB conosce proprio quel file. Dà immagine,
                titolo, descrizione, studio e data.
              </p>
              <p>
                Serve una chiave gratuita: crea un account su{" "}
                <a
                  className={ui.link}
                  href="https://theporndb.net/user/api-tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  theporndb.net
                </a>{" "}
                e crea un «API token».
              </p>
            </Source>
          </ul>
        </div>
        <div className={`${ui.span5} ${ui.stack}`}>
          <OnlineRulesForm
            status={before}
            onSaved={(status) => {
              setState({ kind: "ready", status });
              setProblem("");
              setDone("Regole salvate.");
            }}
          />
          {(before.rules.confirm || before.proposals > 0) && (
            <OnlineProposals
              onChange={(left) =>
                setState({ kind: "ready", status: { ...before, proposals: left } })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Source is one source on the internet: its name and state with the
// switch right beside them, what it does, and the form of its key.
function Source({
  name,
  label = name,
  icon,
  on,
  hasKey,
  disabled,
  onChange,
  keyForm,
  children,
}: {
  name: string;
  label?: string;
  icon: "play" | "film" | "eye";
  on: boolean;
  hasKey?: boolean; // undefined: it needs no key
  disabled: boolean;
  onChange: (on: boolean) => void;
  keyForm?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <li className={`${ui.card} ${pages.source}`} data-on={on || undefined}>
      <div className={pages.sourceHead}>
        <span className={ui.cardIcon} aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <h2 className={pages.sourceName} id={id}>
          {label}
        </h2>
        {hasKey === false ? (
          <Chip tone="warn" icon="key">
            Nessuna chiave salvata
          </Chip>
        ) : hasKey ? (
          <Chip icon="key">La chiave è salvata</Chip>
        ) : null}
        <label className={pages.sourceSwitch}>
          <span aria-hidden="true">{on ? "Accesa" : "Spenta"}</span>
          <input
            type="checkbox"
            role="switch"
            className={ui.switch}
            aria-label={`${name} accesa`}
            aria-describedby={id}
            checked={on}
            aria-checked={on}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
      </div>
      <div className={pages.sourceText}>{children}</div>
      {keyForm}
    </li>
  );
}

// KeyForm saves the key of a source. The key is never shown again: the
// server only says if there is one.
function KeyForm({
  source,
  name,
  hasKey,
  onSaved,
}: {
  source: KeySource;
  name: string;
  hasKey: boolean;
  onSaved: (status: OnlineStatus, source: KeySource, name: string) => void;
}) {
  const [key, setKey] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setProblem("");
    saveKey(source, key.trim())
      .then((status) => {
        setKey("");
        onSaved(status, source, name);
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explainKeyError(error, name));
      })
      .finally(() => setSending(false));
  };

  return (
    <form className={pages.keyForm} onSubmit={send} aria-label={`Salva la chiave di ${name}`}>
      <label className={ui.field}>
        <span className={ui.label}>{hasKey ? `Nuova chiave di ${name}` : `Chiave di ${name}`}</span>
        <input
          className={`${ui.input} ${ui.mono}`}
          type="password"
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <button
        type="submit"
        className={`${ui.btn} ${ui.primary}`}
        disabled={sending || key.trim() === ""}
      >
        <Icon name="key" size={16} />
        Prova e salva
      </button>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}

function explainKeyError(error: unknown, name: string): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return `Questa non sembra una chiave di ${name}. Controlla di averla copiata tutta.`;
      case 422:
        return `${name} dice che questa chiave non è valida. Controlla di averla copiata tutta.`;
      case 502:
        return `${name} non ha risposto: forse manca internet. Riprova tra poco.`;
    }
  }
  return "Non si è riusciti a salvare. Riprova tra poco.";
}
