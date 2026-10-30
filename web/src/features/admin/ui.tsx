import { type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Icon, type IconName } from "../../components/Icon";
import ui from "./Ui.module.css";

export { ui };

// PageHeader is the top of every page of the administration: a big title,
// a sentence on what the page is for, and its main buttons on the right.
export function PageHeader({
  title,
  description,
  actions,
  back,
  below,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  below?: ReactNode; // under the title: chips about the thing shown
}) {
  return (
    <header className={ui.pageHead}>
      <div className={ui.pageHeadText}>
        {back && (
          <Link to={back.to} className={ui.pageBack}>
            <Icon name="chevronLeft" size={18} />
            {back.label}
          </Link>
        )}
        <h1 className={ui.pageTitle}>{title}</h1>
        {description && <p className={ui.pageText}>{description}</p>}
        {below}
      </div>
      {actions && <div className={ui.pageActions}>{actions}</div>}
    </header>
  );
}

// Card is a part of a page: a title with its icon, maybe a line on the
// right, and what it holds.
export function Card({
  title,
  icon,
  sub,
  actions,
  children,
  className,
  tone,
  titleTag: Title = "h2",
  label,
}: {
  title?: ReactNode;
  icon?: IconName | ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: "busy";
  titleTag?: "h2" | "h3";
  label?: string; // a name for the card when it has no title
}) {
  const heading = useId();
  return (
    <section
      className={[ui.card, className].filter(Boolean).join(" ")}
      data-tone={tone}
      aria-labelledby={title ? heading : undefined}
      aria-label={title ? undefined : label}
    >
      {(title || sub || actions) && (
        <div className={ui.cardHead}>
          {title && (
            <Title id={heading} className={ui.cardTitle}>
              {typeof icon === "string" ? (
                <span className={ui.cardIcon} aria-hidden="true">
                  <Icon name={icon as IconName} size={18} />
                </span>
              ) : (
                icon
              )}
              {title}
            </Title>
          )}
          {sub && <span className={ui.cardSub}>{sub}</span>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "ok" | "warn" | "bad" | "live" | "info";

// Chip is a short state: "Pronto", "Nascosto", "Sottotitoli 37%".
export function Chip({
  tone,
  icon,
  children,
}: {
  tone?: Tone;
  icon?: IconName | ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={ui.chip} data-tone={tone}>
      {typeof icon === "string" ? <Icon name={icon as IconName} size={14} /> : icon}
      {children}
    </span>
  );
}

// SettingSwitch is a setting on one line: what it is and what it does on
// the left, the switch right beside it with its state in words. It acts at
// once.
export function SettingSwitch({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  on = "Acceso",
  off = "Spento",
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void | Promise<void>;
  disabled?: boolean;
  on?: string;
  off?: string;
}) {
  const [busy, setBusy] = useState(false);
  const hintId = useId();
  const inputId = useId();
  return (
    <div className={ui.setting}>
      <label className={ui.settingText} htmlFor={inputId}>
        <b>{label}</b>
        <span id={hintId}>{hint}</span>
      </label>
      <span className={ui.settingSide}>
        <span aria-hidden="true">{checked ? on : off}</span>
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          className={ui.switch}
          checked={checked}
          aria-checked={checked}
          aria-label={label}
          aria-describedby={hintId}
          disabled={busy || disabled}
          onChange={(e) => {
            const result = onChange(e.target.checked);
            if (result instanceof Promise) {
              setBusy(true);
              void result.finally(() => setBusy(false));
            }
          }}
        />
      </span>
    </div>
  );
}

// Empty says what will appear in a part of a page that has nothing yet,
// and gives the way to start.
export function Empty({
  icon = "sparkles",
  title,
  children,
  action,
  headingLevel = 2,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={ui.empty}>
      <span className={ui.emptyIcon} aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      <Heading>{title}</Heading>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// Loading holds the place of a page while it comes.
export function Loading() {
  return (
    <div className={ui.loading} aria-busy="true">
      <span className="visually-hidden">Carico…</span>
      <span />
      <span />
    </div>
  );
}

// Unavailable is the page when the server did not answer.
export function Unavailable({ title }: { title: string }) {
  return (
    <Empty icon="alert" title={title}>
      Il server non ha risposto. Ricarica la pagina tra poco.
    </Empty>
  );
}

// Notice is a box that asks to look at something, with its buttons.
export function Notice({
  tone,
  icon = "alert",
  title,
  children,
  actions,
}: {
  tone?: "bad" | "ok" | "info";
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={ui.notice} data-tone={tone}>
      <span className={ui.noticeIcon} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <div className={ui.noticeBody}>
        <h3>{title}</h3>
        {children && <p>{children}</p>}
        {actions && <div className={ui.chips}>{actions}</div>}
      </div>
    </div>
  );
}

// useToast is a short message at the bottom of the page, after an action
// that took effect at once.
export function useToast(): [ReactNode, (text: string, problem?: boolean) => void] {
  const [toast, setToast] = useState<{ text: string; problem: boolean; n: number } | null>(null);
  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const view = (
    <div className={ui.toastBox} aria-live="polite">
      {toast && (
        <p
          key={toast.n}
          role="status"
          className={ui.toast}
          data-problem={toast.problem || undefined}
        >
          <Icon name={toast.problem ? "close" : "check"} size={16} />
          {toast.text}
        </p>
      )}
    </div>
  );
  return [view, (text, problem = false) => setToast({ text, problem, n: Date.now() })];
}

// n writes a number the Italian way: 1.234.
export const n = (x: number) => x.toLocaleString("it-IT");
