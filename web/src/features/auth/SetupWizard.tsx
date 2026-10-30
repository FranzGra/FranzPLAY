import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useId,
  useState,
} from "react";
import { nameProblem, passwordMin, passwordProblem, setup } from "../../api/auth";
import { ApiError } from "../../api/client";
import { type Look, lookProblem, maxNamePart, saveLook } from "../../api/site";
import { accentVariables, isAccentColor } from "../../app/accent";
import { useAuth } from "../../app/auth";
import { useSite } from "../../app/site";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { presets } from "../admin/LookFields";
import { checkSetup, explain } from "./authText";
import styles from "./SetupWizard.module.css";

// The three steps of the first setup, one thing at a time.
const steps = [
  { short: "Chi sei", title: "Come ti chiami?" },
  { short: "Password", title: "Scegli una password" },
  { short: "Il tuo sito", title: "Dai un nome al tuo sito" },
] as const;

type Step = 0 | 1 | 2;
type Direction = "start" | "forward" | "back";

// successPause is how long the final button shows it worked before the
// home appears: just enough to be seen.
const successPause = 550; // milliseconds

// SetupWizard creates the administrator of a brand new FranzPLAY in three
// steps: the name (and the code in the log, when the installer turned it
// on), the password, and the name and color of the site. Each step checks
// its own fields; the server is asked only at the end, as before.
export function SetupWizard({ setupCode }: { setupCode: boolean }) {
  usePageTitle("Benvenuto");
  const { signedIn } = useAuth();
  const site = useSite();
  const look = site.look;
  const [step, setStep] = useState<Step>(0);
  const [direction, setDirection] = useState<Direction>("start");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newLook, setNewLook] = useState<Look>(look);
  const [error, setError] = useState("");
  // shake counts the mistakes, so the message moves again at each one.
  const [shake, setShake] = useState(0);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const errorId = useId();

  // Each step starts with the cursor in its first field: the panel is
  // drawn anew at every step (key), and this runs when it appears.
  const focusFirst = useCallback((panel: HTMLDivElement | null) => {
    panel?.querySelector<HTMLInputElement>("input:not([hidden])")?.focus();
  }, []);

  function go(to: Step) {
    setDirection(to > step ? "forward" : "back");
    setStep(to);
    setError("");
  }

  function fail(problem: string, at: Step) {
    if (at !== step) go(at);
    setError(problem);
    setShake((n) => n + 1);
  }

  async function create() {
    const problem = checkSetup(name, password, confirm);
    if (problem) {
      fail(problem, nameProblem(name) ? 0 : 1);
      return;
    }
    const lookWrong = lookProblem(newLook);
    if (lookWrong) {
      fail(lookWrong, 2);
      return;
    }
    setState("busy");
    setError("");
    try {
      const account = await setup(setupCode ? code : "", name, password);
      await keepLook(newLook);
      setState("done");
      if (animated()) await new Promise((done) => setTimeout(done, successPause));
      signedIn(account);
    } catch (err) {
      setState("idle");
      fail(explain(err, "setup", "password"), stepOf(err));
    }
  }

  // keepLook saves the name and color chosen at the first setup. The
  // administrator is already created: if this fails, FranzPLAY keeps its
  // own name, which can be changed later in Amministrazione › Sito.
  async function keepLook(chosen: Look) {
    const same =
      chosen.nameFirst === look.nameFirst &&
      chosen.nameSecond === look.nameSecond &&
      chosen.color.toLowerCase() === look.color;
    if (same) return;
    try {
      site.changed(await saveLook(chosen));
    } catch (err) {
      console.error(err);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== "idle") return;
    if (step === 0) {
      const problem = nameProblem(name);
      if (problem) fail(problem, 0);
      else go(1);
    } else if (step === 1) {
      const problem = checkSetup(name, password, confirm);
      if (problem) fail(problem, 1);
      else go(2);
    } else {
      void create();
    }
  }

  // The wizard wears the color being chosen, so the choice shows at once.
  const color = newLook.color.toLowerCase();
  const paint = (isAccentColor(color) ? accentVariables(color) : {}) as CSSProperties;
  const describedBy = error ? errorId : undefined;
  const current = steps[step];

  return (
    <main className={styles.root} style={paint}>
      <form className={`glass ${styles.card}`} onSubmit={onSubmit} noValidate>
        <header className={styles.header}>
          <span className={styles.logoMark} aria-hidden="true">
            <Icon name="play" size={18} />
          </span>
          <h1 className={styles.welcome}>Benvenuto in FranzPLAY</h1>
        </header>

        <Progress step={step} />

        <div ref={focusFirst} key={step} className={styles.panel} data-direction={direction}>
          <h2 className={styles.title}>{current.title}</h2>

          {step === 0 && (
            <>
              <p className={styles.intro}>
                Sarai l'amministratore: potrai gestire video, persone e impostazioni.
              </p>
              {setupCode && (
                <>
                  <Field
                    label="Codice di installazione"
                    name="code"
                    value={code}
                    onChange={setCode}
                    autoComplete="off"
                    placeholder="XXXX-XXXX-XXXX…"
                    describedBy={describedBy}
                  />
                  <p className={styles.hint}>
                    Lo trovi nel terminale dove hai avviato FranzPLAY, alla voce{" "}
                    <code>setup_code</code>.
                  </p>
                </>
              )}
              <Field
                label="Nome"
                name="username"
                value={name}
                onChange={setName}
                autoComplete="username"
                describedBy={describedBy}
              />
            </>
          )}

          {step === 1 && (
            <>
              <p className={styles.intro}>
                La userai per entrare come <strong>{name.trim()}</strong>.
              </p>
              {/* For password managers: the name goes with the password. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={name}
                readOnly
                hidden
              />
              <Field
                label="Password"
                name="password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                describedBy={describedBy}
              />
              <Field
                label="Ripeti la password"
                name="confirm"
                type="password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                describedBy={describedBy}
              />
              <PasswordChecks password={password} confirm={confirm} />
            </>
          )}

          {step === 2 && (
            <section className={styles.site} aria-label="Il tuo sito">
              <p className={styles.intro}>
                Puoi lasciarlo così e cambiarlo quando vuoi in Amministrazione › Sito.
              </p>
              <SiteFields look={newLook} onChange={setNewLook} />
            </section>
          )}

          {error && (
            <p key={shake} id={errorId} className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>

        <div className={styles.actions}>
          {step > 0 && (
            <button
              type="button"
              className={styles.back}
              onClick={() => go((step - 1) as Step)}
              disabled={state !== "idle"}
            >
              <Icon name="chevronLeft" size={18} />
              Indietro
            </button>
          )}
          <button
            type="submit"
            className={styles.next}
            data-state={step === 2 ? state : "idle"}
            aria-busy={state === "busy"}
          >
            {step < 2 ? (
              <>
                Avanti
                <span className={styles.nextArrow}>
                  <Icon name="chevronRight" size={18} />
                </span>
              </>
            ) : (
              <FinalLabel state={state} />
            )}
          </button>
        </div>
      </form>
    </main>
  );
}

// Progress shows the three steps as a bar that fills up.
function Progress({ step }: { step: Step }) {
  return (
    <div className={styles.progress}>
      <p className={styles.progressText} aria-live="polite">
        <span>
          Passo {step + 1} di {steps.length}
        </span>
        <span className={styles.progressName}>{steps[step].short}</span>
      </p>
      <ol className={styles.bar} aria-label="Passi">
        {steps.map((s, i) => (
          <li
            key={s.short}
            className={styles.segment}
            data-filled={i <= step}
            aria-current={i === step ? "step" : undefined}
          >
            <span className={styles.srOnly}>{s.short}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// PasswordChecks says, while typing, whether the password is long enough
// and whether the two are the same.
function PasswordChecks({ password, confirm }: { password: string; confirm: string }) {
  const longEnough = passwordProblem(password) === "";
  const same = confirm !== "" && password === confirm;
  return (
    <ul className={styles.checks} aria-live="polite">
      <Check ok={longEnough}>Almeno {passwordMin} caratteri</Check>
      <Check ok={same} wrong={confirm !== "" && !same}>
        {confirm === "" || same ? "Le due password coincidono" : "Le due password non coincidono"}
      </Check>
    </ul>
  );
}

function Check({
  ok,
  wrong = false,
  children,
}: {
  ok: boolean;
  wrong?: boolean;
  children: ReactNode;
}) {
  const state = ok ? "ok" : wrong ? "wrong" : "todo";
  return (
    <li className={styles.check} data-state={state}>
      <span className={styles.checkMark} aria-hidden="true">
        {ok ? <Icon name="check" size={14} /> : wrong ? <Icon name="close" size={14} /> : null}
      </span>
      {children}
    </li>
  );
}

// SiteFields are the name and color of the site, with a preview like the
// top bar of the site will show it.
function SiteFields({ look, onChange }: { look: Look; onChange: (look: Look) => void }) {
  const color = look.color.toLowerCase();
  const custom = !presets.some((p) => p.value === color);
  return (
    <>
      <figure className={styles.preview}>
        <figcaption className={styles.previewCaption}>Anteprima del nome</figcaption>
        <p className={styles.previewBar}>
          <span className={styles.previewMark} aria-hidden="true">
            <Icon name="play" size={14} />
          </span>
          <span className={styles.previewName}>
            {look.nameFirst || "…"}
            <span key={color} className={styles.previewSecond} style={{ color }}>
              {look.nameSecond}
            </span>
          </span>
        </p>
      </figure>
      <div className={styles.names}>
        <Field
          label="Prima parte del nome"
          name="nameFirst"
          value={look.nameFirst}
          onChange={(nameFirst) => onChange({ ...look, nameFirst })}
          autoComplete="off"
          maxLength={maxNamePart}
        />
        <Field
          label="Seconda parte (nel colore)"
          name="nameSecond"
          value={look.nameSecond}
          onChange={(nameSecond) => onChange({ ...look, nameSecond })}
          autoComplete="off"
          maxLength={maxNamePart}
        />
      </div>
      <fieldset className={styles.colors}>
        <legend className={styles.label}>Colore del sito</legend>
        <div className={styles.swatches}>
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              className={styles.swatch}
              style={{ background: p.value }}
              aria-label={p.name}
              aria-pressed={color === p.value}
              title={p.name}
              onClick={() => onChange({ ...look, color: p.value })}
            >
              {color === p.value && <Icon name="check" size={16} />}
            </button>
          ))}
          <label className={styles.custom} data-chosen={custom}>
            <input
              type="color"
              value={color}
              aria-label="Un altro colore"
              onChange={(e) => onChange({ ...look, color: e.target.value })}
            />
            Un altro
          </label>
        </div>
      </fieldset>
    </>
  );
}

function FinalLabel({ state }: { state: "idle" | "busy" | "done" }) {
  switch (state) {
    case "idle":
      return <>Crea e entra</>;
    case "busy":
      return (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          Creo il tuo FranzPLAY…
        </>
      );
    case "done":
      return (
        <>
          <span className={styles.doneMark} aria-hidden="true">
            <Icon name="check" size={18} />
          </span>
          Fatto!
        </>
      );
  }
}

type FieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  autoComplete: string;
  placeholder?: string;
  describedBy?: string;
  maxLength?: number;
};

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  describedBy,
  maxLength,
}: FieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type={type}
        name={name}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-describedby={describedBy}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

// stepOf tells on which step a refusal of the server belongs: a wrong
// code or name on the first, anything else where the person already is.
function stepOf(error: unknown): Step {
  if (error instanceof ApiError && (error.status === 400 || error.status === 401)) return 0;
  return 2;
}

// animated tells whether the browser plays animations: not for whoever
// asked for less motion, nor in tests (jsdom has no Element.animate).
function animated(): boolean {
  if (typeof document.documentElement.animate !== "function") return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
