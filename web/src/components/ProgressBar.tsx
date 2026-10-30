import styles from "./ProgressBar.module.css";

type ProgressBarProps = {
  // percent is how much is done, from 0 to 100. null or undefined when it
  // is not known: the bar then runs back and forth, so something still
  // moves while the system works.
  percent?: number | null;
  // label names what the bar measures, for screen readers: "Scarico il
  // modello medium".
  label: string;
  // size: "small" for the menu and the top bar, "big" for the main work.
  size?: "small" | "normal" | "big";
  // working adds the stripes that slide while the work goes on; off for a
  // bar that only measures (the disks).
  working?: boolean;
  // tone colors the bar: the accent, or a calm or worrying one.
  tone?: "accent" | "warning" | "danger" | "success";
  className?: string;
};

// clamp keeps a percentage between 0 and 100, rounded to one decimal.
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

// ProgressBar shows how far some work is. With a percentage it fills that
// much, with stripes that slide while the work goes on; without one it is
// "indeterminate": a piece of bar slides from side to side. Whoever asked
// their device for less motion sees it still (the CSS stops it).
export function ProgressBar({
  percent,
  label,
  size = "normal",
  working = true,
  tone = "accent",
  className,
}: ProgressBarProps) {
  const known = typeof percent === "number" && Number.isFinite(percent);
  const value = known ? clampPercent(percent) : null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? "In corso" : `${Math.round(value)}%`}
      className={[styles.bar, className].filter(Boolean).join(" ")}
      data-size={size}
      data-tone={tone}
      data-working={working || undefined}
      data-indeterminate={value === null || undefined}
    >
      <span className={styles.fill} style={value === null ? undefined : { width: `${value}%` }} />
    </div>
  );
}

// BusyRing is a small turning ring, beside a title, while work goes on.
export function BusyRing({ size = 18, label }: { size?: number; label?: string }) {
  const ring = (
    <span className={styles.ring} style={{ width: size, height: size }} aria-hidden="true" />
  );
  if (!label) return ring;
  return (
    <output className={styles.ringBox}>
      {ring}
      <span className="visually-hidden">{label}</span>
    </output>
  );
}

// LiveDot is the small pulsing dot beside something running now.
export function LiveDot() {
  return <span className={styles.dot} aria-hidden="true" />;
}
