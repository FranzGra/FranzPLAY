import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import {
  fetchSources,
  type KeySource,
  type OnlineSources,
  type OnlineStatus,
  saveKey,
  saveSources,
} from "../../api/online";
import { EmptyState } from "../../components/EmptyState";
import styles from "./Admin.module.css";
import { OnlineRulesForm } from "./OnlineRules";

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

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Impostazioni non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
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
    <>
      <div className={styles.top}>
        <p className={styles.lead}>
          FranzPLAY funziona anche senza internet. Se accendi una fonte, chiede copertine e
          informazioni dei video che riconosce. Manda solo quello che serve a trovarli (il codice
          del video, titolo e anno del film, o un'impronta del file), niente su di te o su chi usa
          FranzPLAY. Quello che c'è nei file accanto ai video conta sempre di più.
        </p>
      </div>
      <ul className={styles.list} aria-label="Fonti su internet">
        <li className={`glass ${styles.person}`}>
          <div>
            <p className={styles.name}>YouTube</p>
            <p className={styles.role}>
              Per i video scaricati da YouTube, con il codice nel nome del file, come li salva
              yt-dlp: <code>Gita in montagna [dQw4w9WgXcQ].mp4</code>. Dà copertina, titolo e
              canale. Non serve nessuna chiave.
            </p>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              aria-label="YouTube accesa"
              checked={before.youtube}
              disabled={busy}
              onChange={(e) => change({ ...before, youtube: e.target.checked })}
            />
            Accesa
          </label>
        </li>
        <li className={`glass ${styles.person}`}>
          <div>
            <p className={styles.name}>TMDB (film)</p>
            <p className={styles.role}>
              Per i film con titolo e anno nel nome del file: <code>Il sorpasso (1962).mkv</code>{" "}
              oppure <code>The.Matrix.1999.1080p.mkv</code>. Dà immagine, titolo, trama, regista e
              data di uscita. Si usa solo un film con lo stesso titolo e lo stesso anno, così un
              video di famiglia non diventa un film a caso.
            </p>
            <p className={styles.role}>
              Serve una chiave gratuita: crea un account su{" "}
              <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
                themoviedb.org
              </a>{" "}
              e copia la «Chiave API» o il «Token di accesso in lettura».{" "}
              {before.tmdbKey ? "La chiave è salvata." : "Nessuna chiave salvata."}
            </p>
            <p className={styles.role}>
              Questo prodotto usa l'API di TMDB ma non è approvato né certificato da TMDB.
            </p>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              aria-label="TMDB accesa"
              checked={before.tmdb}
              disabled={busy || !before.tmdbKey}
              onChange={(e) => change({ ...before, tmdb: e.target.checked })}
            />
            Accesa
          </label>
          <KeyForm source="tmdb" name="TMDB" hasKey={before.tmdbKey} onSaved={keySaved} />
        </li>
        <li className={`glass ${styles.person}`}>
          <div>
            <p className={styles.name}>ThePornDB</p>
            <p className={styles.role}>
              Per qualsiasi video, di solito quelli né da YouTube né film. FranzPLAY calcola
              un'impronta del file (un numero che dipende solo dal suo contenuto) e manda solo
              quella. Si usa una scena solo se ThePornDB conosce proprio quel file. Dà immagine,
              titolo, descrizione, studio e data.
            </p>
            <p className={styles.role}>
              Serve una chiave gratuita: crea un account su{" "}
              <a href="https://theporndb.net/user/api-tokens" target="_blank" rel="noreferrer">
                theporndb.net
              </a>{" "}
              e crea un «API token».{" "}
              {before.tpdbKey ? "La chiave è salvata." : "Nessuna chiave salvata."}
            </p>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              aria-label="ThePornDB accesa"
              checked={before.tpdb}
              disabled={busy || !before.tpdbKey}
              onChange={(e) => change({ ...before, tpdb: e.target.checked })}
            />
            Accesa
          </label>
          <KeyForm source="tpdb" name="ThePornDB" hasKey={before.tpdbKey} onSaved={keySaved} />
        </li>
      </ul>
      <OnlineRulesForm
        status={before}
        onSaved={(status) => {
          setState({ kind: "ready", status });
          setProblem("");
          setDone("Regole salvate.");
        }}
      />
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={styles.done}>
          {done}
        </p>
      )}
    </>
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
    <form className={styles.inline} onSubmit={send} aria-label={`Salva la chiave di ${name}`}>
      <label className={styles.field}>
        {hasKey ? `Nuova chiave di ${name}` : `Chiave di ${name}`}
        <input
          type="password"
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <button type="submit" className={styles.primary} disabled={sending || key.trim() === ""}>
        Prova e salva
      </button>
      {problem && (
        <p role="alert" className={styles.problem}>
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
