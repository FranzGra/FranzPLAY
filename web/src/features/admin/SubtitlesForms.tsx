import { type FormEvent, useState } from "react";
import {
  askSubtitles,
  askTranslation,
  languageName,
  mainLang,
  type SubtitledVideo,
  type SubtitleSource,
  type SubtitlesSetup,
  spokenUnknown,
  type VideoSubtitle,
} from "../../api/autosubs";
import { ApiError } from "../../api/client";
import { Select } from "../../components/Select";
import subs from "./Subtitles.module.css";
import { TranslatorOff } from "./SubtitlesSetup";
import { ui } from "./ui";

type Guess = { lang: string; why: string };

// guessSpoken looks for the language spoken in what is known of a video, the
// surest first. It only fills the field in: whoever asks sees it and why.
export function guessSpoken(video: SubtitledVideo, languages: string[]): Guess {
  const known = (lang: string) => languages.includes(lang);
  const spoken = video.request?.spoken ?? "";
  if (known(spoken)) return { lang: spoken, why: "L'avevi indicata l'ultima volta." };
  const heard = video.subtitles.find((s) => s.source === "auto" && !s.from);
  if (heard && known(heard.lang)) {
    return { lang: heard.lang, why: "È la lingua dei sottotitoli scritti da Whisper." };
  }
  const track = video.audioLangs.find(known);
  if (track) return { lang: track, why: "Lo dice il file video: controlla che sia giusta." };
  const others = new Set(
    video.subtitles.filter((s) => s.source !== "auto" && s.lang).map((s) => mainLang(s.lang)),
  );
  if (others.size === 1) {
    const [only] = others;
    if (only && known(only)) {
      return {
        lang: only,
        why: "Presa dai sottotitoli già presenti: potrebbero essere una traduzione, controlla.",
      };
    }
  }
  return { lang: "", why: "" };
}

function askProblem(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "Adesso non si può: la situazione del video è cambiata. Ricarica la pagina e riprova.";
  }
  if (error instanceof ApiError && error.status === 503) {
    return "Il traduttore non risponde. Riprova tra poco.";
  }
  return "Non ci sono riuscito. Riprova tra poco.";
}

// PutFirst asks to put the new job before all the others.
function PutFirst({ checked, onChange }: { checked: boolean; onChange: (first: boolean) => void }) {
  return (
    <label className={subs.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Mettilo in cima alla coda, prima degli altri lavori
    </label>
  );
}

// Seconds of work for each second of video, on a small processor. Measured on
// a Celeron N3450: base (a video of 48 minutes in 4 hours and 17, 01-11-2026) and
// the turbo model, which took even longer than this. small was not measured: it
// is an estimate, about three times base, and the page says so.
const baseTimes = 5.3;
const smallTimes = 15;
const turboTimes = 20;

// longTime says a long time in words, in round numbers: "2 ore e 20 minuti".
function longTime(seconds: number): string {
  const minutes =
    seconds < 600 ? Math.max(1, Math.round(seconds / 60)) : Math.round(seconds / 600) * 10;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return minutes === 1 ? "1 minuto" : `${minutes} minuti`;
  const hourWords = hours === 1 ? "1 ora" : `${hours} ore`;
  return rest === 0 ? hourWords : `${hourWords} e ${rest} minuti`;
}

// slowCpuAdvice is what to expect from a model on a processor without AVX2,
// for this video. It only advises: every model can still be chosen.
function slowCpuAdvice(model: string, duration: number | null, hasBase: boolean) {
  const about = (times: number) =>
    duration === null
      ? `circa ${String(times).replace(".", ",")} volte la durata del video`
      : `circa ${longTime(duration * times)} per questo video`;
  if (model === "base") {
    return {
      warn: false,
      words: `Questo processore è lento e base è il modello giusto: ${about(baseTimes)}, misurato su un Celeron.`,
    };
  }
  const better = hasBase
    ? `Ti consiglio base: ${about(baseTimes)}.`
    : `Ti consiglio base, da scaricare in «Altri modelli»: ${about(baseTimes)}.`;
  let cost = `${model} è molto più pesante e non è stato misurato: può volerci più di un giorno.`;
  if (model === "small") cost = `Con small: ${about(smallTimes)}, una stima senza misura.`;
  if (model.includes("turbo")) {
    cost =
      duration === null
        ? "Con questo modello: oltre 20 volte la durata del video, misurato su un Celeron."
        : `Con questo modello: oltre ${longTime(duration * turboTimes)} per questo video, misurato su un Celeron.`;
  }
  return { warn: true, words: `Questo processore è lento. ${cost} ${better}` };
}

// TranscribeForm asks whisper to listen to one video. The language spoken has
// to be said: whisper writes in the language it is told, it does not translate.
export function TranscribeForm({
  setup,
  video,
  onDone,
  onCancel,
}: {
  setup: SubtitlesSetup;
  video: SubtitledVideo;
  onDone: () => void;
  onCancel: () => void;
}) {
  const guess = guessSpoken(video, setup.languages);
  const [spoken, setSpoken] = useState(guess.lang);
  const [model, setModel] = useState(
    video.request && setup.models.includes(video.request.model)
      ? video.request.model
      : setup.slowCpu && setup.models.includes("base")
        ? "base"
        : setup.models.includes("small")
          ? "small"
          : (setup.models[0] ?? ""),
  );
  const [translate, setTranslate] = useState<string[]>(video.request?.translate ?? []);
  const [first, setFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [missing, setMissing] = useState(false);
  const canTranslate = setup.translator && setup.translatorError === "";
  // Subtitles not made here stay: no point in translating over them.
  const taken = video.subtitles.filter((s) => s.source !== "auto").map((s) => mainLang(s.lang));
  const targets = setup.languages.filter(
    (l) => l !== spoken && setup.translatorLanguages.includes(l) && !taken.includes(l),
  );
  const heard = video.subtitles.find((s) => s.source === "auto" && !s.from);
  const same = heard && heard.lang === spoken && heard.model === model;
  const advice = setup.slowCpu
    ? slowCpuAdvice(model, video.duration, setup.models.includes("base"))
    : null;
  const elsewhere =
    spoken !== "" &&
    spoken !== spokenUnknown &&
    video.audioLangs.length > 0 &&
    !video.audioLangs.includes(spoken);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (spoken === "") {
      setMissing(true);
      return;
    }
    setBusy(true);
    setProblem("");
    askSubtitles(video.id, {
      spoken,
      model,
      translate: canTranslate ? translate.filter((l) => targets.includes(l)) : [],
      priority: first || undefined,
    })
      .then(onDone)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(askProblem(error));
        setBusy(false);
      });
  };

  return (
    <form className={subs.ask} onSubmit={submit} aria-label={`Trascrivi ${video.title}`}>
      <p className={subs.askLead}>
        Whisper ascolta il video e scrive ciò che sente, <b>nella lingua in cui si parla</b>. Non
        traduce: per un'altra lingua usa la traduzione, dopo.
      </p>
      <div className={subs.askFields}>
        <span className={ui.field}>
          <span className={ui.label}>Lingua originale del video</span>
          <Select
            aria-label="Lingua originale del video"
            value={spoken}
            options={[
              { value: "", label: "Scegli la lingua…" },
              ...setup.languages.map((l) => ({ value: l, label: languageName(l) })),
              { value: spokenUnknown, label: "Non la so: la riconosce Whisper" },
            ]}
            onChange={(v) => {
              setSpoken(v);
              setMissing(false);
            }}
          />
          {spoken === "" && missing && (
            <span className={ui.problem} role="alert">
              Scegli la lingua in cui si parla nel video.
            </span>
          )}
          {spoken === spokenUnknown && (
            <span className={subs.hint}>
              Whisper decide dai primi secondi e può sbagliare, soprattutto con musica o audio
              sporco.
            </span>
          )}
          {spoken === guess.lang && guess.why && <span className={subs.hint}>{guess.why}</span>}
          {elsewhere && (
            <span className={subs.warn}>
              Il file dice che l'audio è in {video.audioLangs.map(languageName).join(", ")}. Se è
              così, scegli quella lingua: Whisper non traduce.
            </span>
          )}
        </span>
        <span className={ui.field}>
          <span className={ui.label}>Modello</span>
          <Select
            aria-label="Modello"
            value={model}
            options={setup.models.map((m) => ({ value: m, label: m }))}
            onChange={setModel}
          />
          {advice && <span className={advice.warn ? subs.warn : subs.hint}>{advice.words}</span>}
        </span>
      </div>
      {canTranslate && targets.length > 0 ? (
        <fieldset className={subs.translate}>
          <legend className={ui.label}>Poi traduci in (facoltativo)</legend>
          <span className={ui.chips}>
            {targets.map((l) => (
              <label key={l} className={subs.check}>
                <input
                  type="checkbox"
                  checked={translate.includes(l)}
                  onChange={(e) =>
                    setTranslate((t) => (e.target.checked ? [...t, l] : t.filter((x) => x !== l)))
                  }
                />
                {languageName(l)}
              </label>
            ))}
          </span>
        </fieldset>
      ) : (
        !canTranslate && (
          <p className={subs.hint}>
            Il traduttore non è attivo: per ora puoi solo trascrivere. Le traduzioni potrai
            chiederle anche dopo.
          </p>
        )
      )}
      {heard && same && (
        <p className={subs.hint}>
          Questo video è già trascritto così: non lo riascolto, faccio solo le traduzioni che hai
          scelto.
        </p>
      )}
      {heard && !same && spoken !== "" && (
        <p className={subs.warn}>
          Trascrivere di nuovo sostituisce i sottotitoli di Whisper di questo video e cancella le
          loro traduzioni.
        </p>
      )}
      <PutFirst checked={first} onChange={setFirst} />
      <span className={ui.chips}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy}>
          Trascrivi
        </button>
        <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={onCancel}>
          Lascia stare
        </button>
      </span>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}

const sourceWords: Record<SubtitleSource, string> = {
  auto: "scritti da Whisper",
  file: "file accanto al video",
  inside: "dentro il video",
};

type Start = { source: SubtitleSource; from: string };

// startsOf lists what a translation can start from: subtitles in a known
// language that are not translations themselves, whisper's first.
export function startsOf(subtitles: VideoSubtitle[]): Start[] {
  const out: Start[] = [];
  for (const source of ["auto", "file", "inside"] as const) {
    for (const s of subtitles) {
      if (s.source !== source || s.from || !s.lang) continue;
      const from = mainLang(s.lang);
      if (!out.some((o) => o.source === source && o.from === from)) out.push({ source, from });
    }
  }
  return out;
}

// TranslateForm asks to translate subtitles a video already has. When it
// cannot be done it stays, and says why and what to do.
export function TranslateForm({
  setup,
  video,
  onDone,
  onCancel,
}: {
  setup: SubtitlesSetup;
  video: SubtitledVideo;
  onDone: () => void;
  onCancel: () => void;
}) {
  const starts = startsOf(video.subtitles);
  const [picked, setPicked] = useState(0);
  const [to, setTo] = useState<string[]>([]);
  const [redo, setRedo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [missing, setMissing] = useState(false);
  const unnamed = video.subtitles.some((s) => !s.lang);
  const start = starts[Math.min(picked, starts.length - 1)];

  const close = (
    <span className={ui.chips}>
      <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={onCancel}>
        Chiudi
      </button>
    </span>
  );
  const label = `Traduci ${video.title}`;
  const [first, setFirst] = useState(false);

  if (!setup.translator) {
    return (
      <form className={subs.ask} aria-label={label}>
        <p className={subs.askLead}>
          <b>Il traduttore è spento, quindi ora non si può tradurre.</b>
        </p>
        <TranslatorOff setup={setup} />
        {close}
      </form>
    );
  }
  if (setup.translatorError) {
    return (
      <form className={subs.ask} aria-label={label}>
        <p className={subs.askLead}>
          <b>{setup.translatorError}</b>
        </p>
        {setup.translatorHelp.down && <p className={ui.cardText}>{setup.translatorHelp.down}</p>}
        {close}
      </form>
    );
  }
  if (!start) {
    return (
      <form className={subs.ask} aria-label={label}>
        <p className={subs.askLead}>
          <b>Non c'è ancora un testo da tradurre.</b>
        </p>
        <p className={ui.cardText}>
          La traduzione parte da sottotitoli già scritti.{" "}
          {setup.whisper && setup.whisperProblem === "" && setup.models.length > 0
            ? "Prima usa Trascrivi, indicando la lingua in cui si parla; poi torna qui."
            : "Serve prima una trascrizione, ma Whisper qui non è pronto: guarda il riquadro in cima."}
        </p>
        {unnamed && <UnnamedFile />}
        {close}
      </form>
    );
  }

  const known = setup.translatorLanguages;
  const sourceKnown = known.includes(start.from);
  const targets = setup.languages.filter((l) => l !== start.from && known.includes(l));
  const present = (lang: string) => video.subtitles.find((s) => mainLang(s.lang) === lang);
  // Only a translation made here can be made again.
  const redoable = (lang: string) => {
    const s = present(lang);
    return s?.source === "auto" && s.from !== "";
  };
  const canRedo = targets.some(redoable);
  const free = (lang: string) => !present(lang) || (redo && redoable(lang));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const chosen = to.filter((l) => targets.includes(l) && free(l));
    if (chosen.length === 0) {
      setMissing(true);
      return;
    }
    setBusy(true);
    setProblem("");
    askTranslation(video.id, {
      source: start.source,
      from: start.from,
      to: chosen,
      redo: redo && chosen.some(redoable),
      priority: first || undefined,
    })
      .then(onDone)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(askProblem(error));
        setBusy(false);
      });
  };

  return (
    <form className={subs.ask} onSubmit={submit} aria-label={label}>
      <p className={subs.askLead}>
        La traduzione parte dal testo già scritto: <b>non riascolta il video</b> e ci vuole molto
        meno tempo.
      </p>
      {starts.length === 1 ? (
        <p className={subs.from}>
          <span className={ui.label}>Traduci da</span>
          <span>
            {languageName(start.from)} · {sourceWords[start.source]}
          </span>
        </p>
      ) : (
        <span className={ui.field}>
          <span className={ui.label}>Traduci da</span>
          <Select
            aria-label="Traduci da"
            value={String(picked)}
            options={starts.map((s, i) => ({
              value: String(i),
              label: `${languageName(s.from)} · ${sourceWords[s.source]}`,
            }))}
            onChange={(v) => {
              setPicked(Number(v));
              setTo([]);
            }}
          />
        </span>
      )}
      {unnamed && <UnnamedFile />}
      {!sourceKnown ? (
        <p className={subs.warn}>
          Il traduttore non conosce {languageName(start.from).toLowerCase()}. Conosce:{" "}
          {known.map(languageName).join(", ") || "nessuna lingua"}.
        </p>
      ) : targets.length === 0 ? (
        <p className={subs.warn}>Il traduttore non conosce altre lingue in cui tradurre.</p>
      ) : (
        <>
          <fieldset className={subs.translate}>
            <legend className={ui.label}>Traduci in</legend>
            <span className={ui.chips}>
              {targets.map((l) => (
                <label key={l} className={subs.check} data-off={!free(l) || undefined}>
                  <input
                    type="checkbox"
                    disabled={!free(l)}
                    checked={free(l) && to.includes(l)}
                    onChange={(e) => {
                      setMissing(false);
                      setTo((t) => (e.target.checked ? [...t, l] : t.filter((x) => x !== l)));
                    }}
                  />
                  {languageName(l)}
                  {!free(l) && " · già presente"}
                </label>
              ))}
            </span>
          </fieldset>
          {canRedo && (
            <label className={subs.redo}>
              <input type="checkbox" checked={redo} onChange={(e) => setRedo(e.target.checked)} />
              Rifai le traduzioni già presenti
            </label>
          )}
          {missing && (
            <p className={ui.problem} role="alert">
              Scegli almeno una lingua in cui tradurre.
            </p>
          )}
        </>
      )}
      {sourceKnown && targets.length > 0 && <PutFirst checked={first} onChange={setFirst} />}
      <span className={ui.chips}>
        {sourceKnown && targets.length > 0 && (
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy}>
            Traduci
          </button>
        )}
        <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={onCancel}>
          Lascia stare
        </button>
      </span>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}

// UnnamedFile explains why a subtitle file cannot be translated: here the
// only way is to rename the file, and it says so.
function UnnamedFile() {
  return (
    <p className={subs.hint}>
      Un file di sottotitoli accanto al video non dice la sua lingua, quindi non si può tradurre.
      Qui l'unico modo è rinominarlo aggiungendo la lingua, come{" "}
      <code className={ui.mono}>Film.en.srt</code>.
    </p>
  );
}
