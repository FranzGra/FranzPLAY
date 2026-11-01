import { useState } from "react";
import {
  cancelModelDownload,
  deleteTranslatorModel,
  deleteWhisperModel,
  downloadModel,
  languageName,
  type ModelFile,
  type SubtitlesSetup,
  type TranslatorModels,
} from "../../api/autosubs";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { BusyRing, ProgressBar } from "../../components/ProgressBar";
import { formatBytes } from "../../lib/format";
import { downloadPercent } from "./activity";
import { downloadedText } from "./jobText";
import { ConfirmModelDelete, DeleteModelButton, usedSpace } from "./ModelDelete";
import { downloadNumbers } from "./NowJob";
import subs from "./Subtitles.module.css";
import { Notice, ui } from "./ui";

const openKey = "franzplay.subtitles.modelsOpen";

// wasOpen remembers, on this browser, whether the box of models was left
// open. Only a convenience: without storage it simply starts closed.
function wasOpen(): boolean {
  try {
    return window.localStorage.getItem(openKey) === "1";
  } catch {
    return false;
  }
}

function rememberOpen(open: boolean) {
  try {
    window.localStorage.setItem(openKey, open ? "1" : "0");
  } catch {
    // Not remembered: nothing else changes.
  }
}

// useStop stops the model download going on.
function useStop(onChanged: () => void) {
  const [stopping, setStopping] = useState(false);
  const [problem, setProblem] = useState("");
  const stop = () => {
    setProblem("");
    setStopping(true);
    cancelModelDownload()
      .then(onChanged)
      .catch((error: unknown) => {
        // 409: it had just ended by itself; the list says how.
        if (error instanceof ApiError && error.status === 409) return onChanged();
        console.error(error);
        setProblem("Non sono riuscito ad annullarlo. Riprova tra poco.");
      })
      .finally(() => setStopping(false));
  };
  return { stop, stopping, problem };
}

// buildWords says which version of whisper runs here, when there are two.
function buildWords(build: string): string {
  if (build === "complete") return "Versione completa, va su questo processore. ";
  if (build === "basic") return "Versione di base, adatta a questo processore: più lenta. ";
  return "";
}

// SubtitlesSetupBox is what this machine can do: one line for whisper's
// models, one for the translator. They open only when there is something to
// do there.
export function SubtitlesSetupBox({
  setup,
  onChanged,
}: {
  setup: SubtitlesSetup;
  onChanged: () => void;
}) {
  return (
    <div className={subs.setup}>
      {setup.whisper && setup.whisperProblem !== "" ? (
        <Notice icon="subtitles" title="Whisper non può funzionare su questo processore">
          {setup.whisperProblem}
        </Notice>
      ) : setup.whisper ? (
        <ModelsBox setup={setup} onChanged={onChanged} />
      ) : (
        <Notice icon="subtitles" title="I sottotitoli automatici sono spenti">
          Per accenderli installa whisper.cpp su questo computer, così che il programma{" "}
          <code>whisper-cli</code> si trovi (oppure indica dov'è nell'impostazione{" "}
          <code>FRANZPLAY_WHISPER</code>), e riavvia FranzPLAY. Intanto qui vedi lo stesso quali
          video hanno già i sottotitoli.
        </Notice>
      )}
      <TranslatorBox setup={setup} onChanged={onChanged} />
    </div>
  );
}

// ModelsBox is one line while there are models: which are ready, and a
// download going on with its bar and Annulla. With no model it stays open,
// since nothing can be listened to until one is there.
function ModelsBox({ setup, onChanged }: { setup: SubtitlesSetup; onChanged: () => void }) {
  const [wanted, setWanted] = useState(wasOpen);
  const none = setup.models.length === 0;
  const open = none || wanted;
  const d = setup.download;
  const going = d !== null && !d.ended;
  const percent = d && going ? downloadPercent(d) : null;
  const { stop, stopping, problem } = useStop(onChanged);

  const toggle = () => {
    rememberOpen(!open);
    setWanted(!open);
  };

  return (
    <section className={subs.panel} aria-label="Modelli di Whisper">
      <div className={subs.line}>
        <span className={subs.lineIcon} data-tone={none ? "warn" : "ok"}>
          {going ? <BusyRing size={18} /> : <Icon name={none ? "alert" : "check"} size={18} />}
        </span>
        <p className={subs.lineText}>
          {none ? (
            <b>Manca il modello di Whisper</b>
          ) : (
            <>
              <b>Whisper è pronto</b>
              <span className={subs.lineMore}>
                {buildWords(setup.whisperBuild)}Modelli: {setup.models.join(", ")}
                {usedSpace(setup.modelFiles)}
              </span>
            </>
          )}
        </p>
        {!none && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small} ${ui.ghost}`}
            aria-expanded={open}
            onClick={toggle}
          >
            {open ? "Chiudi" : "Altri modelli"}
            <span className={subs.chevron} data-open={open || undefined}>
              <Icon name="chevronDown" size={16} />
            </span>
          </button>
        )}
      </div>

      {!open && d && going && (
        <div className={subs.download}>
          <div className={subs.downloadHead} role="status">
            <span>Scarico {d.name}</span>
            {percent !== null && <b>{Math.floor(percent)}%</b>}
          </div>
          <ProgressBar percent={percent} label={`Scarico il modello ${d.name}`} />
          <div className={subs.downloadFoot}>
            <p className={subs.downloadNumbers}>{downloadNumbers(d, percent)}</p>
            <button
              type="button"
              className={`${ui.btn} ${ui.small}`}
              disabled={stopping}
              onClick={stop}
              aria-label={`Annulla il download di ${d.name}`}
            >
              <Icon name="close" size={16} />
              Annulla
            </button>
          </div>
        </div>
      )}
      {!open && d?.ended && !d.canceled && d.error !== "" && (
        <p className={ui.problem} role="alert">
          {d.name}: {d.error}
        </p>
      )}
      {!open && problem && (
        <p className={ui.problem} role="alert">
          {problem}
        </p>
      )}

      {open && (
        <div className={subs.panelBody}>
          <p className={ui.cardText}>
            Il modello è «l'orecchio» di Whisper: più è grande, più capisce e più è lento. FranzPLAY
            può scaricarlo da solo qui sotto, oppure puoi mettere tu i file come{" "}
            <code className={ui.mono}>ggml-small.bin</code> nella cartella{" "}
            <code className={ui.mono}>{setup.modelsFolder}</code>.
          </p>
          <Downloads setup={setup} onChanged={onChanged} />
        </div>
      )}
    </section>
  );
}

// megabytes writes a size for people: "466 MB".
function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1 << 20)).toLocaleString("it-IT")} MB`;
}

// Downloads lists the models FranzPLAY can download; the one downloading
// shows its bar right under its own row.
function Downloads({ setup, onChanged }: { setup: SubtitlesSetup; onChanged: () => void }) {
  const [startProblem, setStartProblem] = useState("");
  const [asking, setAsking] = useState("");
  const [deleted, setDeleted] = useState("");
  const { stop, stopping, problem: stopProblem } = useStop(onChanged);
  const d = setup.download;
  const going = d !== null && !d.ended;
  const problem = startProblem || stopProblem;
  // Models copied into the folder by hand: FranzPLAY cannot download them
  // again, but they take space all the same.
  const byHand = setup.modelFiles.filter((f) => !setup.downloadable.some((m) => m.name === f.name));
  if (setup.downloadable.length === 0 && byHand.length === 0) return null;

  // What a model leaves behind, in the words of the question.
  const effect = (name: string, again: string) =>
    `I sottotitoli già scritti restano. ${again}${
      setup.models.length === 1 && setup.models[0] === name
        ? " È l'unico modello: finché non ne hai un altro non puoi trascrivere."
        : ""
    }`;

  const deleting = (file: ModelFile, again: string) => (
    <>
      {file.busy && <p className={subs.modelBusy}>{file.busy}</p>}
      {asking === file.name && (
        <ConfirmModelDelete
          file={file}
          title={file.name}
          effect={effect(file.name, again)}
          remove={() => deleteWhisperModel(file.name)}
          onCancel={() => setAsking("")}
          onDone={() => {
            setAsking("");
            setDeleted(`${file.name} eliminato: ${formatBytes(file.size)} liberati.`);
            onChanged();
          }}
        />
      )}
    </>
  );

  const start = (name: string) => {
    setStartProblem("");
    setDeleted("");
    downloadModel(name)
      .then(onChanged)
      .catch((error: unknown) => {
        console.error(error);
        setStartProblem("Non posso scaricarlo adesso: forse un altro modello sta già scaricando.");
      });
  };

  return (
    <>
      <ul className={subs.models} aria-label="Modelli da scaricare">
        {setup.downloadable.map((m) => {
          const here = setup.models.includes(m.name);
          const mine = d !== null && d.name === m.name;
          const percent = mine && d ? downloadPercent(d) : null;
          const file = setup.modelFiles.find((f) => f.name === m.name);
          return (
            <li key={m.name} className={subs.model} data-busy={(mine && going) || undefined}>
              <div className={subs.modelRow}>
                <span className={subs.modelText}>
                  <span>
                    <b>{m.name}</b> <span className={subs.size}>{megabytes(m.size)}</span>
                  </span>
                  <span className={subs.about}>{m.about}</span>
                </span>
                {here ? (
                  <span className={subs.modelActions}>
                    <span className={ui.chip} data-tone="ok">
                      <Icon name="check" size={14} />
                      Già qui
                    </span>
                    {file && (
                      <DeleteModelButton
                        title={m.name}
                        busy={file.busy !== ""}
                        asking={asking === m.name}
                        onAsk={() => {
                          setDeleted("");
                          setAsking(m.name);
                        }}
                      />
                    )}
                  </span>
                ) : mine && going ? (
                  <button
                    type="button"
                    className={`${ui.btn} ${ui.small}`}
                    disabled={stopping}
                    onClick={stop}
                    aria-label={`Annulla il download di ${m.name}`}
                  >
                    <Icon name="close" size={16} />
                    Annulla
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`${ui.btn} ${ui.small}`}
                    disabled={going}
                    onClick={() => start(m.name)}
                    aria-label={`Scarica ${m.name}`}
                  >
                    <Icon name="download" size={16} />
                    Scarica
                  </button>
                )}
              </div>
              {file && deleting(file, "Potrai scaricarlo di nuovo da qui quando vuoi.")}
              {mine && d && going && (
                <div className={subs.download}>
                  <p className={subs.downloadHead} role="status">
                    <span>
                      <BusyRing size={16} />
                      Scarico {d.name}
                    </span>
                    {percent !== null && <b>{Math.floor(percent)}%</b>}
                  </p>
                  <ProgressBar percent={percent} label={`Scarico il modello ${d.name}`} />
                  <p className={subs.downloadNumbers}>{downloadNumbers(d, percent)}</p>
                </div>
              )}
              {mine && d?.ended && d.error === "" && (
                <p className={subs.downloadDone} role="status">
                  <Icon name="check" size={16} />
                  {d.name} scaricato.
                </p>
              )}
              {mine && d?.ended && d.canceled && (
                <p className={subs.downloadDone} data-tone="quiet" role="status">
                  <Icon name="close" size={16} />
                  Download di {d.name} annullato.
                </p>
              )}
              {mine && d?.ended && !d.canceled && d.error !== "" && (
                <p className={ui.problem} role="alert">
                  {d.name}: {d.error}
                </p>
              )}
            </li>
          );
        })}
        {byHand.map((f) => (
          <li key={f.name} className={subs.model}>
            <div className={subs.modelRow}>
              <span className={subs.modelText}>
                <span>
                  <b>{f.name}</b> <span className={subs.size}>{formatBytes(f.size)}</span>
                </span>
                <span className={subs.about}>Copiato a mano nella cartella dei modelli.</span>
              </span>
              <span className={subs.modelActions}>
                <span className={ui.chip} data-tone="ok">
                  <Icon name="check" size={14} />
                  Già qui
                </span>
                <DeleteModelButton
                  title={f.name}
                  busy={f.busy !== ""}
                  asking={asking === f.name}
                  onAsk={() => {
                    setDeleted("");
                    setAsking(f.name);
                  }}
                />
              </span>
            </div>
            {deleting(f, "Da qui non si può scaricare di nuovo: dovrai ricopiarlo tu.")}
          </li>
        ))}
      </ul>
      {deleted && (
        <p className={subs.downloadDone} role="status">
          <Icon name="check" size={16} />
          {deleted}
        </p>
      )}
      {problem && (
        <p className={ui.problem} role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

// knownNames says which languages the translator knows, in a few words.
function knownNames(langs: string[]): string {
  if (langs.length === 0) return "nessuna lingua";
  if (langs.length > 6) return `${langs.length} lingue`;
  return langs.map(languageName).join(", ");
}

// TranslatorBox is one line on the translator. What to do when it is off, or
// does not answer, comes from the server: only it knows which engine it is.
function TranslatorBox({ setup, onChanged }: { setup: SubtitlesSetup; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const help = setup.translatorHelp;
  const models = setup.translatorModels;
  if (setup.translator && !setup.translatorError && models) {
    return (
      <TranslatorModelsBox
        models={models}
        languages={setup.translatorLanguages}
        onChanged={onChanged}
      />
    );
  }
  if (setup.translator && !setup.translatorError) {
    return (
      <section className={subs.panel} aria-label="Traduttore">
        <div className={subs.line}>
          <span className={subs.lineIcon} data-tone="ok">
            <Icon name="check" size={18} />
          </span>
          <p className={subs.lineText}>
            <b>Il traduttore è pronto</b>
            <span className={subs.lineMore}>Lingue: {knownNames(setup.translatorLanguages)}</span>
          </p>
        </div>
      </section>
    );
  }
  if (setup.translator) {
    return (
      <section className={subs.panel} aria-label="Traduttore">
        <div className={subs.line}>
          <span className={subs.lineIcon} data-tone="warn">
            <Icon name="alert" size={18} />
          </span>
          <p className={subs.lineText} role="alert">
            <b>{setup.translatorError}</b>
            {help.down && <span className={subs.lineMore}>{help.down}</span>}
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className={subs.panel} aria-label="Traduttore">
      <div className={subs.line}>
        <span className={subs.lineIcon}>
          <Icon name="info" size={18} />
        </span>
        <p className={subs.lineText}>
          <b>Il traduttore è spento</b>
          <span className={subs.lineMore}>Puoi trascrivere, ma non tradurre.</span>
        </p>
        <button
          type="button"
          className={`${ui.btn} ${ui.small} ${ui.ghost}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Chiudi" : "Come attivarlo"}
          <span className={subs.chevron} data-open={open || undefined}>
            <Icon name="chevronDown" size={16} />
          </span>
        </button>
      </div>
      {open && (
        <div className={subs.panelBody}>
          <TranslatorOff setup={setup} />
        </div>
      )}
    </section>
  );
}

// modelName names a model, which goes one way: "Inglese → Italiano".
function modelName(pair: string): string {
  const [from = "", to = ""] = pair.split("-");
  return `${languageName(from)} → ${languageName(to)}`;
}

// TranslatorModelsBox is the line of a translator that downloads its models by
// itself: nothing to press, the models come when a translation needs them.
function TranslatorModelsBox({
  models,
  languages,
  onChanged,
}: {
  models: TranslatorModels;
  languages: string[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState("");
  const [deleted, setDeleted] = useState("");
  const percent = models.total > 0 ? (100 * models.done) / models.total : null;
  return (
    <section className={subs.panel} aria-label="Traduttore">
      <div className={subs.line}>
        <span className={subs.lineIcon} data-tone="ok">
          <Icon name="check" size={18} />
        </span>
        <p className={subs.lineText}>
          <b>Il traduttore è pronto</b>
          <span className={subs.lineMore}>
            Lingue: {knownNames(languages)}. Il modello di due lingue si scarica da solo la prima
            volta che serve (circa 36 MB per direzione); tra due lingue diverse dall'inglese passa
            dall'inglese.
          </span>
          <span className={subs.lineMore}>
            {models.have.length > 0
              ? `Già scaricati: ${models.have.map(modelName).join(", ")}${usedSpace(models.files)}.`
              : "Nessun modello scaricato finora."}
          </span>
        </p>
        {models.files.length > 0 && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small} ${ui.ghost}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Chiudi" : "Modelli scaricati"}
            <span className={subs.chevron} data-open={open || undefined}>
              <Icon name="chevronDown" size={16} />
            </span>
          </button>
        )}
      </div>
      {open && (models.files.length > 0 || deleted) && (
        <div className={subs.panelBody}>
          <ul className={subs.models} aria-label="Modelli di traduzione scaricati">
            {models.files.map((f) => (
              <li key={f.name} className={subs.model}>
                <div className={subs.modelRow}>
                  <span className={subs.modelText}>
                    <span>
                      <b>{modelName(f.name)}</b>{" "}
                      <span className={subs.size}>{formatBytes(f.size)}</span>
                    </span>
                  </span>
                  <span className={subs.modelActions}>
                    <DeleteModelButton
                      title={modelName(f.name)}
                      busy={f.busy !== ""}
                      asking={asking === f.name}
                      onAsk={() => {
                        setDeleted("");
                        setAsking(f.name);
                      }}
                    />
                  </span>
                </div>
                {f.busy && <p className={subs.modelBusy}>{f.busy}</p>}
                {asking === f.name && (
                  <ConfirmModelDelete
                    file={f}
                    title={modelName(f.name)}
                    effect="Le traduzioni già fatte restano. Se servirà di nuovo, si scarica da solo alla prossima traduzione, con Internet."
                    remove={() => deleteTranslatorModel(f.name)}
                    onCancel={() => setAsking("")}
                    onDone={() => {
                      setAsking("");
                      setDeleted(
                        `${modelName(f.name)} eliminato: ${formatBytes(f.size)} liberati.`,
                      );
                      onChanged();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          {deleted && (
            <p className={subs.downloadDone} role="status">
              <Icon name="check" size={16} />
              {deleted}
            </p>
          )}
        </div>
      )}
      {models.name && (
        <div className={subs.panelBody}>
          <p className={subs.status} role="status">
            <BusyRing size={16} />
            <span>Scarico il modello {modelName(models.name)}</span>
          </p>
          <ProgressBar percent={percent} label={`Modello ${modelName(models.name)}`} />
          <p className={subs.listened}>
            {percent !== null && <b>{Math.floor(percent)}%</b>}
            <span>{downloadedText(models.done, models.total)}</span>
          </p>
        </div>
      )}
    </section>
  );
}

// TranslatorOff explains how to have a translator, in its engine's words.
export function TranslatorOff({ setup }: { setup: SubtitlesSetup }) {
  const help = setup.translatorHelp;
  return (
    <>
      <p className={ui.cardText}>{help.off || "Su questo server non c'è un traduttore."}</p>
      {help.setup && <pre className={subs.lines}>{help.setup}</pre>}
      {help.after && <p className={ui.cardText}>{help.after}</p>}
    </>
  );
}
