import { useEffect, useRef, useState } from "react";
import { type Method, methodNames, patternMin, pinLength, secretProblem } from "../../../api/auth";
import authStyles from "../AuthPage.module.css";
import { PatternGrid } from "./PatternGrid";
import { PinPad } from "./PinPad";
import styles from "./Secret.module.css";

// NewChoice is what NewSecret has so far: a method and its secret, or
// the reason it is not ready yet.
export type NewChoice = { method: Method; secret: string; problem: string };

// warnings explain, briefly, why a PIN or a pattern is weaker.
export const warnings: Record<Method, string> = {
  password: "",
  pin: `Un PIN di ${pinLength} cifre è comodo, ma è meno sicuro di una password: è più facile da indovinare o da sbirciare. Dopo 3 errori l'accesso si blocca per qualche minuto.`,
  pattern:
    "Una sequenza è comoda, ma è meno sicura di una password: è più facile da indovinare o da vedere mentre la disegni. Dopo 3 errori l'accesso si blocca per qualche minuto.",
};

// NewSecret lets someone choose how to log in, among allowed, and set a
// new password, PIN or pattern, typed twice. onChange hears every step.
export function NewSecret({
  allowed,
  initial,
  onChange,
  disabled = false,
  passwordLabel = "Password",
}: {
  allowed: readonly Method[];
  initial?: Method;
  onChange: (choice: NewChoice) => void;
  disabled?: boolean;
  passwordLabel?: string;
}) {
  const [method, setMethod] = useState<Method>(
    initial && allowed.includes(initial) ? initial : (allowed[0] ?? "password"),
  );
  // Passwords: two fields. PIN and pattern: TwoSteps, which reports the
  // confirmed secret ("" until both steps agree).
  const [first, setFirst] = useState("");
  const [again, setAgain] = useState("");

  const choice: NewChoice =
    method === "password"
      ? {
          method,
          secret: first,
          problem:
            secretProblem("password", first) ||
            (first !== again ? "Le due password non sono uguali." : ""),
        }
      : {
          method,
          secret: first,
          problem:
            first === ""
              ? `${method === "pin" ? "Scegli il PIN" : "Disegna la sequenza"} e ripetilo per conferma.`
              : "",
        };
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the answer changes
  useEffect(() => onChange(choice), [choice.method, choice.secret, choice.problem]);

  const pick = (m: Method) => {
    setMethod(m);
    setFirst("");
    setAgain("");
  };

  return (
    <div className={styles.choose}>
      {allowed.length > 1 && (
        <div className={styles.segments} role="radiogroup" aria-label="Come vuoi entrare">
          {allowed.map((m) => (
            // biome-ignore lint/a11y/useSemanticElements: a segmented control, like the others in FranzPLAY
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === method}
              className={styles.segment}
              disabled={disabled}
              onClick={() => pick(m)}
            >
              {methodNames[m]}
            </button>
          ))}
        </div>
      )}
      {warnings[method] && <p className={styles.warning}>{warnings[method]}</p>}

      {method === "password" && (
        <>
          <label className={authStyles.field}>
            <span className={authStyles.label}>{passwordLabel}</span>
            <input
              className={authStyles.input}
              type="password"
              value={first}
              autoComplete="new-password"
              disabled={disabled}
              onChange={(e) => setFirst(e.target.value)}
            />
          </label>
          <label className={authStyles.field}>
            <span className={authStyles.label}>Ripeti la password</span>
            <input
              className={authStyles.input}
              type="password"
              value={again}
              autoComplete="new-password"
              disabled={disabled}
              onChange={(e) => setAgain(e.target.value)}
            />
          </label>
        </>
      )}

      {method !== "password" && (
        <TwoSteps key={method} method={method} disabled={disabled} onConfirmed={setFirst} />
      )}
    </div>
  );
}

type Phase = "draw" | "review" | "confirm" | "done";

const texts = {
  pin: {
    step1: `Scegli un PIN di ${pinLength} cifre`,
    step2: "Ripeti il PIN per confermare",
    label1: "Nuovo PIN",
    label2: "Ripeti il PIN",
    review: `PIN di ${pinLength} cifre inserito.`,
    redo: "Riscrivi",
    mismatch: "I due PIN non sono uguali. Riprova, o ricomincia da capo.",
    done: "PIN confermato",
  },
  pattern: {
    step1: "Disegna la sequenza",
    step2: "Ridisegnala per confermare",
    label1: "Nuova sequenza",
    label2: "Ripeti la sequenza",
    review: "",
    redo: "Ridisegna",
    mismatch: "Le due sequenze non sono uguali. Riprova, o ricomincia da capo.",
    done: "Sequenza confermata",
  },
} as const;

// TwoSteps sets a new PIN or pattern in two steps, shown by two dots:
// first it is chosen and shown back (to redo it or go on), then typed or
// drawn again to confirm. A wrong confirmation stays at step 2, to try
// again or start over. onConfirmed gets the secret, or "" while not done.
function TwoSteps({
  method,
  disabled,
  onConfirmed,
}: {
  method: "pin" | "pattern";
  disabled: boolean;
  onConfirmed: (secret: string) => void;
}) {
  const t = texts[method];
  const [phase, setPhase] = useState<Phase>("draw");
  const [first, setFirst] = useState("");
  const [typing, setTyping] = useState("");
  const [note, setNote] = useState("");
  const [shake, setShake] = useState(0);
  // round remounts the pad or the grid, so it takes the focus again.
  const [round, setRound] = useState(0);
  const go = useRef<HTMLButtonElement>(null);
  // clearing is the timer that empties a wrong pattern once shown in red.
  const clearing = useRef(0);
  useEffect(() => () => window.clearTimeout(clearing.current), []);
  const changeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase === "review") go.current?.focus();
    if (phase === "done") changeButton.current?.focus();
  }, [phase]);

  const to = (next: Phase, why = "") => {
    window.clearTimeout(clearing.current);
    setPhase(next);
    setTyping("");
    setNote(why);
    setRound((n) => n + 1);
    if (next !== "done") onConfirmed("");
  };
  const restart = () => {
    setFirst("");
    to("draw");
  };
  // wrong shows a mistake: the pad or the grid shakes (the drawn pattern
  // turns red for a moment), and the person tries again at the same step.
  const wrong = (why: string) => {
    setNote(why);
    setShake((n) => n + 1);
    window.clearTimeout(clearing.current);
    if (method === "pattern") clearing.current = window.setTimeout(() => setTyping(""), 600);
    else setTyping("");
  };

  const complete = (value: string) => {
    if (phase === "draw") {
      const problem = secretProblem(method, value);
      if (problem) {
        wrong(method === "pattern" ? `Unisci almeno ${patternMin} punti.` : problem);
        return;
      }
      setFirst(value);
      to("review");
      return;
    }
    if (value !== first) {
      wrong(t.mismatch);
      return;
    }
    to("done");
    onConfirmed(value);
  };

  const step = phase === "draw" || phase === "review" ? 1 : 2;
  const title = step === 1 ? t.step1 : t.step2;
  const live =
    note ||
    (phase === "review"
      ? `Passo 1 completato. ${method === "pin" ? t.review : `Sequenza di ${first.length} punti.`} Puoi continuare o ${t.redo.toLowerCase()}.`
      : phase === "done"
        ? t.done
        : `Passo ${step} di 2: ${title}.`);

  if (phase === "done") {
    return (
      <div className={styles.done}>
        <span>{t.done}</span>
        <button ref={changeButton} type="button" className={styles.textButton} onClick={restart}>
          Cambia
        </button>
        <p className="visually-hidden" aria-live="polite">
          {live}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.steps}>
      <ol className={styles.stepper} aria-label="Passi">
        {[1, 2].map((n) => (
          <li
            key={n}
            className={`${styles.stepDot} ${n === step ? styles.stepNow : ""} ${n < step || (n === 1 && phase === "review") ? styles.stepDone : ""}`}
            aria-current={n === step ? "step" : undefined}
          >
            <span aria-hidden="true">{n < step || (n === 1 && phase === "review") ? "✓" : n}</span>
            <span className="visually-hidden">
              Passo {n}
              {n < step ? ", fatto" : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.stepTitle}>{title}</p>
      <p className="visually-hidden" aria-live="polite">
        {live}
      </p>

      {phase === "review" ? (
        <div className={styles.review}>
          {method === "pattern" ? (
            <PatternGrid
              value={first}
              onChange={() => {}}
              onComplete={() => {}}
              label="La sequenza disegnata"
              disabled
            />
          ) : (
            <div className={styles.dots} aria-hidden="true">
              {Array.from({ length: pinLength }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the dots are fixed places
                <span key={i} className={`${styles.dot} ${styles.dotOn}`} />
              ))}
            </div>
          )}
          {method === "pin" && <p className={styles.count}>{t.review}</p>}
          <div className={styles.stepActions}>
            <button type="button" className={styles.secondary} onClick={restart}>
              {t.redo}
            </button>
            <button ref={go} type="button" className={styles.primary} onClick={() => to("confirm")}>
              Continua
            </button>
          </div>
        </div>
      ) : (
        <>
          {method === "pin" ? (
            <PinPad
              key={round}
              value={typing}
              onChange={setTyping}
              onComplete={complete}
              label={step === 1 ? t.label1 : t.label2}
              disabled={disabled}
              shake={shake}
              autoFocus
            />
          ) : (
            <PatternGrid
              key={round}
              value={typing}
              onChange={(v) => {
                // A new drawing started: the red one must not wipe it.
                window.clearTimeout(clearing.current);
                setTyping(v);
                if (v !== "") setNote("");
              }}
              onComplete={complete}
              label={step === 1 ? t.label1 : t.label2}
              disabled={disabled}
              shake={shake}
              autoFocus
            />
          )}
          {note && (
            <p className={authStyles.error} role="alert">
              {note}
            </p>
          )}
          {phase === "confirm" && (
            <div className={styles.stepActions}>
              <button type="button" className={styles.secondary} onClick={restart}>
                Ricomincia
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
