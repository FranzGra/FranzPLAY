import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { pinLength } from "../../../api/auth";
import styles from "./Secret.module.css";

const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

// PinPad is a keypad of digits for a PIN of exactly pinLength digits. It
// works with the fingers, the mouse and the computer's keyboard (digits,
// Backspace, Escape to start again). When the last digit is in, onComplete
// gets the PIN. shake, when it changes, makes the dots shake: a wrong PIN.
export function PinPad({
  value,
  onChange,
  onComplete,
  label,
  autoFocus = false,
  disabled = false,
  shake = 0,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  shake?: number;
}) {
  // A hidden field takes the keyboard (and tells screen readers what this
  // is); it asks phones for no keyboard of their own, the keypad is here.
  const input = useRef<HTMLInputElement>(null);
  // pressed lights up the key typed on the keyboard, as if touched.
  const [pressed, setPressed] = useState("");
  const [shaking, setShaking] = useState(false);

  // Also after a wrong PIN: while the server answered, the field was
  // disabled, and a disabled field loses the focus.
  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled]);

  // seenShake is the error count already shown: a pad or grid made anew
  // (another method, another step) does not shake for an old mistake.
  const seenShake = useRef(shake);
  useEffect(() => {
    if (shake === seenShake.current) return;
    seenShake.current = shake;
    setShaking(true);
    const timer = window.setTimeout(() => setShaking(false), 420);
    return () => window.clearTimeout(timer);
  }, [shake]);

  useEffect(() => {
    if (!pressed) return;
    const timer = window.setTimeout(() => setPressed(""), 140);
    return () => window.clearTimeout(timer);
  }, [pressed]);

  const type = (digit: string) => {
    if (disabled || value.length >= pinLength) return;
    const next = value + digit;
    onChange(next);
    if (next.length === pinLength) onComplete?.(next);
  };
  const erase = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };

  // onKeyDown only lights up the key; the typing arrives in onType.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (/^[0-9]$/.test(event.key)) setPressed(event.key);
    else if (event.key === "Backspace") setPressed("back");
    else if (event.key === "Escape" && value !== "") {
      event.preventDefault();
      onChange("");
    }
  };
  const onType = (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const next = event.target.value.replace(/[^0-9]/g, "").slice(0, pinLength);
    onChange(next);
    if (next.length === pinLength && value.length < pinLength) onComplete?.(next);
  };

  return (
    <div className={styles.pin}>
      <input
        ref={input}
        className={`visually-hidden ${styles.pinField}`}
        type="password"
        inputMode="none"
        autoComplete="off"
        aria-label={`${label}, ${pinLength} cifre`}
        value={value}
        maxLength={pinLength}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={onType}
      />
      <div className={`${styles.dots} ${shaking ? styles.shake : ""}`} aria-hidden="true">
        {Array.from({ length: pinLength }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the dots are fixed places
          <span key={i} className={`${styles.dot} ${i < value.length ? styles.dotOn : ""}`} />
        ))}
      </div>
      <p className={styles.count} aria-live="polite">
        {value.length} cifre su {pinLength}
      </p>
      <div className={styles.keys}>
        {keys.map((k) => (
          <Key
            key={k}
            label={k}
            pressed={pressed === k}
            disabled={disabled}
            onPress={() => type(k)}
          />
        ))}
        <span />
        <Key label="0" pressed={pressed === "0"} disabled={disabled} onPress={() => type("0")} />
        <Key
          label="⌫"
          name="Cancella l'ultima cifra"
          pressed={pressed === "back"}
          disabled={disabled || value === ""}
          onPress={erase}
          quiet
        />
      </div>
    </div>
  );
}

function Key({
  label,
  name,
  pressed,
  disabled,
  onPress,
  quiet = false,
}: {
  label: string;
  name?: string;
  pressed: boolean;
  disabled: boolean;
  onPress: () => void;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.key} ${quiet ? styles.keyQuiet : ""} ${pressed ? styles.keyPressed : ""}`}
      aria-label={name ?? label}
      disabled={disabled}
      // The keypad itself listens to the keyboard: the keys are only for
      // fingers and the mouse, so Tab does not walk through ten buttons.
      tabIndex={-1}
      // Pressing a key leaves the focus in the hidden field, so the
      // computer's keyboard keeps working after a click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {label}
    </button>
  );
}
