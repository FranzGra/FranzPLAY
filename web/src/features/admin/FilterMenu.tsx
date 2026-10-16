import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import styles from "./FilterMenu.module.css";

export type FilterOption<T extends string> = { value: T; label: string; count?: number };

// FilterMenu is a button that opens a short menu of filters, one of them
// on. The button says which; it stands out when it is not the first,
// "everything". Arrows move, Enter or Space choose, Esc or a click outside
// close it, and the focus goes back to the button.
export function FilterMenu<T extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];
  const active = value !== options[0]?.value;

  useEffect(() => {
    if (!open) return;
    const at = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
    items.current[at]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, options, value]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items.current.filter((b): b is HTMLButtonElement => b !== null);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={root} className={styles.root}>
      <button
        ref={button}
        type="button"
        className={`glass ${styles.button} ${active ? styles.active : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Filtro: ${current?.label ?? ""}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="sliders" size={16} />
        <span>{current?.label}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div
          id={menuId}
          className={styles.menu}
          role="menu"
          aria-label="Quali video"
          onKeyDown={onKey}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className={`${styles.item} ${o.count === 0 ? styles.empty : ""}`}
              tabIndex={-1}
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              <span className={styles.check} aria-hidden="true">
                {o.value === value && <Icon name="check" size={16} />}
              </span>
              <span className={styles.label}>{o.label}</span>
              {o.count !== undefined && <span className={styles.count}>{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
