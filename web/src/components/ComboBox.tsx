import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "../lib/presence";
import styles from "./ComboBox.module.css";
import { Icon } from "./Icon";
import { useListPlace } from "./listPlace";
import list from "./Select.module.css";

type ComboBoxProps = {
  id?: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  // inputClassName gives the field the look of the form it is in.
  inputClassName?: string;
  placeholder?: string;
  maxLength?: number;
  // toggleLabel names the arrow and the list, for who cannot see them.
  toggleLabel: string;
  // newLabel is the last choice while typing words that are not in the list.
  newLabel: (text: string) => string;
};

// ComboBox is a field to write in that also offers a list of choices. It
// replaces the browser's own <datalist>, which shows only the choices that
// match what is already in the field: with a word written, the others could
// not be reached. A click opens the whole list; typing narrows it; words not
// in the list stay as they are.
export function ComboBox({
  id,
  value,
  options,
  onChange,
  inputClassName = "",
  placeholder,
  maxLength,
  toggleLabel,
  newLabel,
}: ComboBoxProps) {
  const ownId = useId();
  const listId = `${ownId}-list`;
  const boxRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // typing is true after a change in the field: only then the list narrows.
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(-1);

  const text = value.trim();
  const needle = text.toLowerCase();
  const choices = (
    typing && needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options
  ).map((o) => ({ value: o, label: o }));
  if (typing && text && !options.includes(text)) {
    choices.push({ value: text, label: newLabel(text) });
  }
  const shown = open && choices.length > 0;
  const current = active < choices.length ? active : -1;

  const place = useListPlace(boxRef, shown);
  const presence = usePresence<NonNullable<typeof place>, HTMLDivElement>(shown ? place : null);

  // Opening shows every choice, with the one in the field highlighted.
  const show = () => {
    setTyping(false);
    setActive(options.indexOf(text));
    setOpen(true);
  };

  const choose = (choice: string) => {
    setOpen(false);
    inputRef.current?.focus();
    if (choice !== value) onChange(choice);
  };

  // A click or touch anywhere else closes the list, and what is written stays.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (boxRef.current?.contains(target) || presence.ref.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, presence.ref]);

  // The highlighted choice stays in sight while the arrows move through a long list.
  useEffect(() => {
    if (!shown || current < 0) return;
    const item = presence.ref.current?.children[current] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: "nearest" });
  }, [shown, current, presence.ref]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!shown) {
        show();
      } else if (key === "ArrowDown") {
        setActive(Math.min(current + 1, choices.length - 1));
      } else {
        setActive(Math.max(current - 1, 0));
      }
    } else if (key === "Enter" && shown) {
      // With the list open, Enter settles the choice: only the next one saves.
      event.preventDefault();
      const choice = choices[current];
      if (choice) choose(choice.value);
      else setOpen(false);
    } else if (key === "Escape" && shown) {
      // Only the list closes, not the window it may be in.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (key === "Tab") {
      setOpen(false);
    }
  };

  const shownPlace = presence.shown;
  return (
    <span ref={boxRef} className={styles.box}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && current >= 0 ? `${ownId}-${current}` : undefined}
        autoComplete="off"
        className={`${inputClassName} ${styles.input}`}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setTyping(true);
          setActive(-1);
          setOpen(true);
        }}
        onClick={() => {
          if (!shown) show();
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className={styles.toggle}
        tabIndex={-1}
        aria-label={toggleLabel}
        onClick={() => {
          inputRef.current?.focus();
          if (shown) setOpen(false);
          else show();
        }}
      >
        <span className={styles.chevron} data-open={shown || undefined}>
          <Icon name="chevronDown" size={18} />
        </span>
      </button>
      {shownPlace &&
        createPortal(
          <div
            ref={presence.ref}
            id={listId}
            role="listbox"
            aria-label={toggleLabel}
            className={`${list.list} ${styles.list} ${"bottom" in shownPlace ? list.above : ""}`}
            data-leaving={presence.leaving || undefined}
            style={{
              left: shownPlace.left,
              width: shownPlace.width,
              maxHeight: shownPlace.maxHeight,
              ...("top" in shownPlace ? { top: shownPlace.top } : { bottom: shownPlace.bottom }),
            }}
          >
            {choices.map((choice, index) => (
              // The keyboard stays in the field (aria-activedescendant): the
              // arrows and Enter are handled there.
              // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled by the field.
              <div
                key={choice.label}
                id={`${ownId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={choice.value === text}
                data-active={index === current || undefined}
                className={list.option}
                onPointerEnter={() => setActive(index)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(choice.value)}
              >
                <span className={styles.words}>{choice.label}</span>
                {choice.value === text && (
                  <span className={list.tick} aria-hidden="true">
                    <Icon name="check" size={18} />
                  </span>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
