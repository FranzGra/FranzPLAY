import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  fetchTitleRules,
  maxFind,
  maxRules,
  previewTitles,
  saveTitleRules,
  type TitleExample,
  type TitlePreset,
  type TitleRule,
  type TitleSettings,
} from "../../api/titleRules";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import pages from "./Pages.module.css";
import styles from "./TitleRules.module.css";
import { Card, Chip, Loading, PageHeader, SettingSwitch, Unavailable, ui } from "./ui";

// A rule on the page, with a key of its own so the list can move.
type Row = TitleRule & { key: number };

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      saved: TitleSettings;
      presets: TitlePreset[];
      examples: TitleExample[];
    };

let nextKey = 1;
const withKey = (rule: TitleRule): Row => ({ ...rule, key: nextKey++ });
const withoutKey = ({ find, replace, regex, on }: Row): TitleRule => ({ find, replace, regex, on });

// TitleRulesPage holds the rules that turn the names of the video files into
// the titles people see. They run one after the other, in their order; the
// files are never renamed, and a title written by hand always wins.
export function TitleRulesPage() {
  usePageTitle("Regole titoli");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchTitleRules(controller.signal)
      .then((p) =>
        setState({ kind: "ready", saved: p.settings, presets: p.presets, examples: p.examples }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setState({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <div className={ui.ui}>
      <PageHeader
        title="Regole titoli"
        description="Come i nomi dei file diventano i titoli che si vedono: le regole si applicano una dopo l'altra, nell'ordine della lista. I file sul disco non cambiano mai, e un titolo scritto a mano resta com'è."
      />
      {state.kind === "loading" && <Loading />}
      {state.kind === "error" && <Unavailable title="Regole non disponibili" />}
      {state.kind === "ready" && (
        <RulesEditor
          saved={state.saved}
          presets={state.presets}
          examples={state.examples}
          onSaved={(saved) => setState({ ...state, saved })}
        />
      )}
    </div>
  );
}

function RulesEditor({
  saved,
  presets,
  examples,
  onSaved,
}: {
  saved: TitleSettings;
  presets: TitlePreset[];
  examples: TitleExample[];
  onSaved: (s: TitleSettings) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => saved.rules.map(withKey));
  const [categories, setCategories] = useState(saved.categories);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  const settings: TitleSettings = { rules: rows.map(withoutKey), categories };
  const unchanged = JSON.stringify(settings) === JSON.stringify(saved);

  const change = (key: number, part: Partial<TitleRule>) => {
    setDone("");
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...part } : r)));
  };
  const move = (index: number, by: -1 | 1) => {
    setDone("");
    setRows((rs) => {
      const to = index + by;
      if (to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      [next[index], next[to]] = [next[to] as Row, next[index] as Row];
      return next;
    });
  };
  const remove = (key: number) => {
    setDone("");
    setRows((rs) => rs.filter((r) => r.key !== key));
  };
  const add = (rule: TitleRule) => {
    setDone("");
    setRows((rs) => (rs.length >= maxRules ? rs : [...rs, withKey(rule)]));
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setDone("");
    saveTitleRules(settings)
      .then((result) => {
        onSaved(result.settings);
        setRows(result.settings.rules.map(withKey));
        setCategories(result.settings.categories);
        setDone(
          result.changed === 0
            ? "Salvato. Nessun titolo è cambiato."
            : `Salvato. Titoli aggiornati su ${result.changed} video.`,
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(
          error instanceof ApiError && error.status === 400
            ? error.message
            : "Non sono riuscito a salvare. Riprova tra poco.",
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className={ui.grid}>
      <div className={`${ui.span7} ${ui.stack}`}>
        <Card title="Regole" icon="sliders" sub={rows.length === 0 ? "Nessuna regola" : undefined}>
          <form className={pages.editor} onSubmit={save} aria-label="Regole dei titoli">
            {rows.length === 0 ? (
              <p className={ui.cardText}>
                Nessuna regola: il titolo è il nome del file senza l'estensione. Aggiungine una qui
                sotto, o parti da quelle pronte.
              </p>
            ) : (
              <ol className={styles.rules}>
                {rows.map((r, i) => (
                  <RuleRow
                    key={r.key}
                    rule={r}
                    index={i}
                    last={i === rows.length - 1}
                    disabled={busy}
                    onChange={(part) => change(r.key, part)}
                    onMove={(by) => move(i, by)}
                    onRemove={() => remove(r.key)}
                  />
                ))}
              </ol>
            )}

            <div className={styles.add}>
              <button
                type="button"
                className={`${ui.btn} ${ui.small}`}
                disabled={busy || rows.length >= maxRules}
                onClick={() => add({ find: "", replace: "", regex: false, on: true })}
              >
                <Icon name="plus" size={16} />
                Aggiungi regola
              </button>
              {rows.length >= maxRules && (
                <span className={ui.hint}>Al massimo {maxRules} regole.</span>
              )}
            </div>

            <div className={styles.presets}>
              <span className={ui.label}>Regole pronte</span>
              <span className={ui.chips}>
                {presets.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className={`${ui.btn} ${ui.small} ${ui.ghost}`}
                    disabled={busy || rows.length >= maxRules}
                    onClick={() => add(p.rule)}
                  >
                    <Icon name="plus" size={14} />
                    {p.name}
                  </button>
                ))}
              </span>
              <span className={ui.hint}>
                Si aggiungono in fondo alla lista; niente cambia finché non salvi.
              </span>
            </div>

            <div className={ui.settingList}>
              <SettingSwitch
                label="Applica anche alle categorie"
                hint="Le stesse regole puliscono anche i nomi delle cartelle che diventano categorie. Un nome scelto a mano per una categoria resta com'è."
                checked={categories}
                disabled={busy}
                onChange={(on) => {
                  setDone("");
                  setCategories(on);
                }}
              />
            </div>

            <div className={pages.formFoot}>
              <span />
              <div className={ui.chips}>
                {unchanged ? (
                  <Chip tone="ok" icon="check">
                    Nessuna modifica da salvare
                  </Chip>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.ghost}`}
                      disabled={busy}
                      onClick={() => {
                        setRows(saved.rules.map(withKey));
                        setCategories(saved.categories);
                        setProblem("");
                      }}
                    >
                      Annulla
                    </button>
                    <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy}>
                      <Icon name="check" size={16} />
                      {busy ? "Salvo…" : "Salva regole"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {problem && (
              <p role="alert" className={ui.problem}>
                {problem}
              </p>
            )}
            {done && (
              <p role="status" className={ui.okText}>
                {done}
              </p>
            )}
          </form>
        </Card>
      </div>
      <div className={`${ui.span5} ${ui.stack}`}>
        <Preview settings={settings} examples={examples} />
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  index,
  last,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  rule: Row;
  index: number;
  last: boolean;
  disabled: boolean;
  onChange: (part: Partial<TitleRule>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const n = index + 1;
  // A replacement made only of spaces looks empty in its field: say it.
  const spaces = rule.replace !== "" && rule.replace.trim() === "";
  return (
    <li className={styles.rule} data-off={rule.on ? undefined : true}>
      <span className={styles.number} aria-hidden="true">
        {n}
      </span>
      <div className={styles.fields}>
        <label className={ui.field} htmlFor={`${id}-find`}>
          <span className={ui.label}>Cerca</span>
          <input
            id={`${id}-find`}
            className={`${ui.input} ${styles.code}`}
            value={rule.find}
            maxLength={maxFind}
            placeholder={rule.regex ? "\\[[^\\]]*\\]" : "_"}
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            aria-label={`Regola ${n}: testo da cercare`}
            onChange={(e) => onChange({ find: e.target.value })}
          />
        </label>
        <label className={ui.field} htmlFor={`${id}-replace`}>
          <span className={ui.label}>Sostituisci con</span>
          <input
            id={`${id}-replace`}
            className={`${ui.input} ${styles.code}`}
            value={rule.replace}
            maxLength={maxFind}
            placeholder="(niente)"
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            aria-label={`Regola ${n}: testo che lo sostituisce`}
            aria-describedby={spaces ? `${id}-spaces` : undefined}
            onChange={(e) => onChange({ replace: e.target.value })}
          />
          {spaces && (
            <span id={`${id}-spaces`} className={ui.hint}>
              {rule.replace.length === 1 ? "Uno spazio" : `${rule.replace.length} spazi`}
            </span>
          )}
        </label>
        <div className={styles.options}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={rule.regex}
              disabled={disabled}
              onChange={(e) => onChange({ regex: e.target.checked })}
            />
            Espressione regolare
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={rule.on}
              disabled={disabled}
              onChange={(e) => onChange({ on: e.target.checked })}
            />
            Attiva
          </label>
        </div>
      </div>
      <div className={styles.tools}>
        <button
          type="button"
          className={`${ui.btn} ${ui.small} ${ui.iconBtn} ${ui.ghost}`}
          disabled={disabled || index === 0}
          aria-label={`Sposta su la regola ${n}`}
          title="Sposta su"
          onClick={() => onMove(-1)}
        >
          <span className={styles.up}>
            <Icon name="chevronDown" size={18} />
          </span>
        </button>
        <button
          type="button"
          className={`${ui.btn} ${ui.small} ${ui.iconBtn} ${ui.ghost}`}
          disabled={disabled || last}
          aria-label={`Sposta giù la regola ${n}`}
          title="Sposta giù"
          onClick={() => onMove(1)}
        >
          <Icon name="chevronDown" size={18} />
        </button>
        <button
          type="button"
          className={`${ui.btn} ${ui.small} ${ui.iconBtn} ${ui.ghost}`}
          disabled={disabled}
          aria-label={`Togli la regola ${n}`}
          title="Togli"
          onClick={onRemove}
        >
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
  );
}

// Preview shows what the rules on the page, even unsaved, make of a name
// typed here and of some real videos of the folders.
function Preview({ settings, examples }: { settings: TitleSettings; examples: TitleExample[] }) {
  const [typed, setTyped] = useState("Il_mio_video_[1080p].mp4");
  const [result, setResult] = useState<{ titles: string[]; folders: string[] } | null>(null);
  const [problem, setProblem] = useState("");
  const latest = useRef(0);

  const folders = [...new Set(examples.map((e) => e.folder).filter((f) => f !== ""))];
  const names = [typed, ...examples.map((e) => e.file)];
  // One text for what is asked: the preview is asked again only when it changes.
  const ask = JSON.stringify({ settings, names, folders });

  useEffect(() => {
    const call = ++latest.current;
    const controller = new AbortController();
    const asked = JSON.parse(ask) as {
      settings: TitleSettings;
      names: string[];
      folders: string[];
    };
    const timer = window.setTimeout(() => {
      previewTitles(asked.settings, asked.names, asked.folders, controller.signal)
        .then((r) => {
          if (call !== latest.current) return;
          setResult(r);
          setProblem("");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || call !== latest.current) return;
          if (error instanceof ApiError && error.status === 400) {
            setProblem(error.message);
          } else {
            console.error(error);
            setProblem("Non riesco a mostrare l'anteprima ora.");
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ask]);

  const titleOf = (i: number) => result?.titles[i] ?? "…";
  return (
    <Card title="Anteprima" icon="eye">
      <label className={ui.field}>
        <span className={ui.label}>Prova un nome di file</span>
        <input
          className={`${ui.input} ${styles.code}`}
          value={typed}
          maxLength={255}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <p className={styles.result} aria-live="polite">
        <span className={ui.label}>Diventa</span>
        <b>{problem ? "—" : titleOf(0)}</b>
      </p>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
      {examples.length > 0 && (
        <div className={styles.examples}>
          <span className={ui.label}>Video della libreria</span>
          <ul className={styles.exampleList}>
            {examples.map((e, i) => (
              <li key={e.file}>
                <span className={styles.file}>{e.file}</span>
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
                <b>{problem ? "—" : titleOf(i + 1)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {settings.categories && folders.length > 0 && (
        <div className={styles.examples}>
          <span className={ui.label}>Categorie</span>
          <ul className={styles.exampleList}>
            {folders.map((f, i) => (
              <li key={f}>
                <span className={styles.file}>{f}</span>
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
                <b>{problem ? "—" : (result?.folders[i] ?? "…")}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className={ui.hint}>
        L'estensione non compare mai nel titolo. Un video con un titolo scritto a mano, o preso da
        internet o da un file accanto, tiene quello.
      </p>
    </Card>
  );
}
