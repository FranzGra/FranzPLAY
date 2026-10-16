import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { patternMin } from "../../../api/auth";
import styles from "./Secret.module.css";

// The grid: 9 dots numbered 1 to 9 row by row, in a 300×300 drawing.
const size = 300;
const step = size / 3;
const hitRadius = 38; // how close the finger must pass to take a dot

export function dotCenter(dot: number): { x: number; y: number } {
  const i = dot - 1;
  return { x: step / 2 + (i % 3) * step, y: step / 2 + Math.floor(i / 3) * step };
}

// addDot adds a dot to a pattern, as Android does: a line that passes
// over a dot not taken yet (1 to 3 passes over 2) takes it too. Dots
// already in the pattern are skipped.
export function addDot(pattern: string, dot: number): string {
  const d = String(dot);
  if (pattern.includes(d)) return pattern;
  const last = Number(pattern.at(-1));
  if (last) {
    const a = dotCenter(last);
    const b = dotCenter(dot);
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (let m = 1; m <= 9; m++) {
      const c = dotCenter(m);
      if (c.x === middle.x && c.y === middle.y && !pattern.includes(String(m))) {
        pattern += String(m);
      }
    }
  }
  return pattern + d;
}

function dotAt(x: number, y: number): number {
  for (let dot = 1; dot <= 9; dot++) {
    const c = dotCenter(dot);
    if (Math.hypot(c.x - x, c.y - y) <= hitRadius) return dot;
  }
  return 0;
}

// PatternGrid lets people draw a pattern on 9 dots with a finger or the
// mouse; when they lift it, onComplete gets the pattern. Without a
// pointer, the arrows move between the dots, Space or Enter takes one,
// Backspace drops the last, and the "Fatto" button sends it. shake, when
// it changes, shows the pattern was wrong.
export function PatternGrid({
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
  onComplete: (value: string) => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  shake?: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const dots = useRef<(HTMLButtonElement | null)[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(5);
  const [wrong, setWrong] = useState(false);
  // byKeyboard: the pattern is being built with the keys, so it waits
  // for "Fatto" instead of ending when the finger lifts.
  const [byKeyboard, setByKeyboard] = useState(false);

  // Also after a wrong pattern: disabled while the server answered, the
  // dots lost the focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it becomes usable again
  useEffect(() => {
    if (autoFocus && !disabled) dots.current[focused - 1]?.focus();
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (shake === 0) return;
    setWrong(true);
    const timer = window.setTimeout(() => setWrong(false), 600);
    return () => window.clearTimeout(timer);
  }, [shake]);

  const point = (event: PointerEvent): { x: number; y: number } => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - box.left) / box.width) * size,
      y: ((event.clientY - box.top) / box.height) * size,
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const p = point(event);
    const dot = dotAt(p.x, p.y);
    setByKeyboard(false);
    setDrawing(true);
    setPointer(p);
    onChange(dot ? String(dot) : "");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing) return;
    const p = point(event);
    setPointer(p);
    const dot = dotAt(p.x, p.y);
    if (dot) {
      const next = addDot(value, dot);
      if (next !== value) onChange(next);
    }
  };

  const onPointerUp = () => {
    if (!drawing) return;
    setDrawing(false);
    setPointer(null);
    if (value !== "") onComplete(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, dot: number) => {
    if (disabled) return;
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      const next = dot + move;
      const sameRow = Math.abs(move) === 3 || Math.ceil(next / 3) === Math.ceil(dot / 3);
      if (next >= 1 && next <= 9 && sameRow) {
        setFocused(next);
        dots.current[next - 1]?.focus();
      }
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setByKeyboard(true);
      onChange(addDot(byKeyboard ? value : "", dot));
    } else if (event.key === "Backspace") {
      event.preventDefault();
      onChange(value.slice(0, -1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      onChange("");
    }
  };

  const path = [...value].map((d) => dotCenter(Number(d)));
  const last = path.at(-1);
  const short = value.length > 0 && value.length < patternMin;

  return (
    <div className={styles.pattern}>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset breaks the drawing's size in Chrome */}
      <div
        role="group"
        className={`${styles.board} ${wrong ? styles.wrong : ""} ${wrong ? styles.shake : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={label}
      >
        <svg ref={svg} viewBox={`0 0 ${size} ${size}`} className={styles.lines} aria-hidden="true">
          {path.length > 1 && (
            <polyline points={path.map((p) => `${p.x},${p.y}`).join(" ")} className={styles.line} />
          )}
          {drawing && last && pointer && (
            <line x1={last.x} y1={last.y} x2={pointer.x} y2={pointer.y} className={styles.trail} />
          )}
        </svg>
        {Array.from({ length: 9 }, (_, i) => {
          const dot = i + 1;
          const order = value.indexOf(String(dot));
          const c = dotCenter(dot);
          return (
            <button
              key={dot}
              ref={(el) => {
                dots.current[i] = el;
              }}
              type="button"
              className={`${styles.patternDot} ${order >= 0 ? styles.patternDotOn : ""}`}
              style={{ left: `${(c.x / size) * 100}%`, top: `${(c.y / size) * 100}%` }}
              tabIndex={dot === focused ? 0 : -1}
              aria-label={`Punto ${dot}${order >= 0 ? `, ${order + 1}° della sequenza` : ""}`}
              aria-pressed={order >= 0}
              disabled={disabled}
              onFocus={() => setFocused(dot)}
              onKeyDown={(event) => onKeyDown(event, dot)}
            >
              <span />
            </button>
          );
        })}
      </div>
      <p className={styles.count} aria-live="polite">
        {value === ""
          ? "Unisci almeno 5 punti"
          : `${value.length} ${value.length === 1 ? "punto" : "punti"}${short ? `: ne servono almeno ${patternMin}` : ""}`}
      </p>
      {byKeyboard && value !== "" && (
        <div className={styles.patternActions}>
          <button type="button" className={styles.textButton} onClick={() => onChange("")}>
            Ricomincia
          </button>
          <button
            type="button"
            className={styles.textButton}
            disabled={disabled}
            onClick={() => {
              setByKeyboard(false);
              onComplete(value);
            }}
          >
            Fatto
          </button>
        </div>
      )}
    </div>
  );
}
