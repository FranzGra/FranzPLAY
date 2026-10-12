import { type PointerEvent, useRef, useState } from "react";
import { formatDuration } from "../../lib/format";
import { timeAt } from "./controls";
import styles from "./Player.module.css";

type TimelineProps = {
  time: number;
  duration: number;
  buffered: number;
  onSeek: (time: number) => void;
};

// Timeline is the big bar under the video: it shows how far the video is
// and how much is downloaded. Drag or click it to jump; it grows under the
// pointer and shows the time it points at.
export function Timeline({ time, duration, buffered, onSeek }: TimelineProps) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  function pointTime(event: PointerEvent): number {
    const rect = bar.current?.getBoundingClientRect();
    return rect ? timeAt(event.clientX, rect.left, rect.width, duration) : 0;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    onSeek(pointTime(event));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const t = pointTime(event);
    setHover(t);
    if (dragging) onSeek(t);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  }

  const known = Number.isFinite(duration) && duration > 0;
  const percent = (t: number) => (known ? `${Math.min((t / duration) * 100, 100)}%` : "0%");
  return (
    <div
      ref={bar}
      className={styles.timeline}
      data-active={dragging || hover !== null ? "" : undefined}
      role="slider"
      tabIndex={0}
      aria-label="Posizione nel video"
      aria-valuemin={0}
      aria-valuemax={known ? Math.floor(duration) : 0}
      aria-valuenow={Math.floor(time)}
      aria-valuetext={`${formatDuration(time)} di ${known ? formatDuration(duration) : "durata sconosciuta"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
    >
      <div className={styles.track}>
        <div className={styles.buffered} style={{ width: percent(buffered) }} />
        {hover !== null && <div className={styles.hovered} style={{ width: percent(hover) }} />}
        <div className={styles.played} style={{ width: percent(time) }} />
      </div>
      <div className={styles.thumb} style={{ left: percent(time) }} />
      {hover !== null && known && (
        <div className={styles.tooltip} style={{ left: percent(hover) }} aria-hidden="true">
          {formatDuration(hover)}
        </div>
      )}
    </div>
  );
}
