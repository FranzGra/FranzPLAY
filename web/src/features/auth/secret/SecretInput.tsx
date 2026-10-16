import { type Method, methodNames } from "../../../api/auth";
import authStyles from "../AuthPage.module.css";
import { PatternGrid } from "./PatternGrid";
import { PinPad } from "./PinPad";

// SecretInput asks for an existing password, PIN or pattern, the right
// way for method. A password is sent with its form; a PIN and a pattern
// call onComplete by themselves when they are whole.
export function SecretInput({
  method,
  value,
  onChange,
  onComplete,
  label,
  autoFocus = false,
  disabled = false,
  shake = 0,
  describedBy,
  autoComplete = "current-password",
}: {
  method: Method;
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  shake?: number;
  describedBy?: string;
  autoComplete?: string;
}) {
  const name = label ?? methodNames[method];
  switch (method) {
    case "pin":
      return (
        <PinPad
          value={value}
          onChange={onChange}
          onComplete={onComplete}
          label={name}
          autoFocus={autoFocus}
          disabled={disabled}
          shake={shake}
        />
      );
    case "pattern":
      return (
        <PatternGrid
          value={value}
          onChange={onChange}
          onComplete={onComplete}
          label={name}
          autoFocus={autoFocus}
          disabled={disabled}
          shake={shake}
        />
      );
    case "password":
      return (
        <label className={authStyles.field}>
          <span className={authStyles.label}>{name}</span>
          <input
            className={authStyles.input}
            type="password"
            value={value}
            autoComplete={autoComplete}
            aria-describedby={describedBy}
            // biome-ignore lint/a11y/noAutofocus: shown right after the person typed the name
            autoFocus={autoFocus}
            disabled={disabled}
            required
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      );
  }
}
