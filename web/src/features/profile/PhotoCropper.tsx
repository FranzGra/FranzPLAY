import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { clampOffset, cropRect, maxZoom, minZoom, type Point, scale } from "./crop";
import styles from "./PhotoCropper.module.css";
import type { LoadedPhoto } from "./photo";

// The side of the round window, in screen pixels.
const view = 260;

// PhotoCropper shows the chosen picture in a round window: the person
// drags it and zooms until their face is in the middle, then saves. Arrow
// keys move it too.
export function PhotoCropper({
  photo,
  saving,
  problem,
  onSave,
  onCancel,
}: {
  photo: LoadedPhoto;
  saving: boolean;
  problem: string;
  onSave: (rect: { x: number; y: number; side: number }) => void;
  onCancel: () => void;
}) {
  const [zoom, setZoom] = useState(minZoom);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const drag = useRef<{ start: Point; from: Point } | null>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const move = (next: Point, z = zoom) => setOffset(clampOffset(photo, view, z, next));
  const s = scale(photo, view, zoom);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, from: offset };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    move({ x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 10;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: step, y: 0 },
      ArrowRight: { x: -step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    move({ x: offset.x + m.x, y: offset.y + m.y });
  };

  return (
    <div className={styles.backdrop}>
      <div
        className={`glass ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
      >
        <h2 id="crop-title" className={styles.title}>
          Sistema la foto
        </h2>
        <p className={styles.hint}>Trascina la foto e usa lo zoom finché ti piace.</p>
        <div
          className={styles.window}
          style={{ width: view, height: view }}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys move the photo
          tabIndex={0}
          aria-label="Foto da ritagliare: trascinala o usa le frecce"
          role="img"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <img
            src={photo.url}
            alt=""
            draggable={false}
            className={styles.image}
            style={{
              width: photo.width * s,
              height: photo.height * s,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
        </div>
        <label className={styles.zoom}>
          Zoom
          <input
            type="range"
            min={minZoom}
            max={maxZoom}
            step={0.01}
            value={zoom}
            onChange={(e) => {
              const z = Number(e.target.value);
              setZoom(z);
              move(offset, z);
            }}
          />
        </label>
        {problem && (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        )}
        <div className={styles.buttons}>
          <button type="button" className={`glass ${styles.cancel}`} onClick={onCancel}>
            Annulla
          </button>
          <button
            type="button"
            className={styles.save}
            disabled={saving}
            onClick={() => onSave(cropRect(photo, view, zoom, offset))}
          >
            {saving ? "Salvo…" : "Salva la foto"}
          </button>
        </div>
      </div>
    </div>
  );
}
