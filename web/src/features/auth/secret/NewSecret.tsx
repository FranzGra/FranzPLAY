import { useEffect, useState } from "react";
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
  // Passwords: two fields. PIN and pattern: first, then again to confirm.
  const [first, setFirst] = useState("");
  const [again, setAgain] = useState("");
  const [typing, setTyping] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [shake, setShake] = useState(0);

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
            confirming || first === ""
              ? `${method === "pin" ? "Scegli il PIN" : "Disegna la sequenza"} e ripetilo per conferma.`
              : "",
        };
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the answer changes
  useEffect(() => onChange(choice), [choice.method, choice.secret, choice.problem]);

  const pick = (m: Method) => {
    setMethod(m);
    setFirst("");
    setAgain("");
    setTyping("");
    setConfirming(false);
    setNote("");
  };

  const restart = (why: string) => {
    setFirst("");
    setTyping("");
    setConfirming(false);
    setNote(why);
    setShake((n) => n + 1);
  };

  const complete = (value: string) => {
    if (!confirming) {
      const problem = secretProblem(method, value);
      if (problem) {
        restart(problem);
        return;
      }
      setFirst(value);
      setTyping("");
      setConfirming(true);
      setNote("");
      return;
    }
    if (value !== first) {
      restart(
        method === "pin"
          ? "I due PIN non sono uguali: sceglilo di nuovo."
          : "Le due sequenze non sono uguali: disegnala di nuovo.",
      );
      return;
    }
    setTyping("");
    setConfirming(false);
    setNote("");
  };

  const ready = method !== "password" && first !== "" && !confirming;

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

      {method !== "password" && ready && (
        <div className={styles.done} role="status">
          <span>{method === "pin" ? "PIN confermato" : "Sequenza confermata"}</span>
          <button type="button" className={styles.textButton} onClick={() => pick(method)}>
            Cambia
          </button>
        </div>
      )}

      {method !== "password" && !ready && (
        <>
          <p className={styles.stepTitle}>
            {method === "pin"
              ? confirming
                ? "Ripeti il PIN"
                : `Scegli un PIN di ${pinLength} cifre`
              : confirming
                ? "Disegna di nuovo la sequenza"
                : `Disegna una sequenza di almeno ${patternMin} punti`}
          </p>
          {method === "pin" ? (
            <PinPad
              key={confirming ? "again" : "first"}
              value={typing}
              onChange={setTyping}
              onComplete={complete}
              label={confirming ? "Ripeti il PIN" : "Nuovo PIN"}
              disabled={disabled}
              shake={shake}
              autoFocus
            />
          ) : (
            <PatternGrid
              key={confirming ? "again" : "first"}
              value={typing}
              onChange={setTyping}
              onComplete={complete}
              label={confirming ? "Ripeti la sequenza" : "Nuova sequenza"}
              disabled={disabled}
              shake={shake}
            />
          )}
          {note && (
            <p className={authStyles.error} role="alert">
              {note}
            </p>
          )}
        </>
      )}
    </div>
  );
}
