import {
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LoadedPhoto } from "../profile/photo";
import styles from "./CoverCropper.module.css";
import {
  clampOffset,
  cropRect,
  maxZoom,
  minZoom,
  type Point,
  type Rect,
  scale,
  windowOf,
} from "./coverCrop";

// The window, in screen pixels: 16:9, and narrow enough for a small phone.
const window169 = windowOf(272);

// CoverCropper shows the chosen picture in a window the shape of a cover
// (16:9), for the cover of a video or the image of a category:
// the administrator drags it and zooms until the right part shows, then
// saves. Arrow keys move it too.
export function CoverCropper({
  picture,
  saving,
  problem,
  onSave,
  onCancel,
  ref,
  leaving = false,
  title = "Sistema la copertina",
  saveLabel = "Usa come copertina",
}: {
  picture: LoadedPhoto;
  title?: string;
  saveLabel?: string;
  saving: boolean;
  problem: string;
  onSave: (rect: Rect) => void;
  onCancel: () => void;
  ref?: Ref<HTMLDivElement>; // the window, for its closing move
  leaving?: boolean; // the window is closing
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

  const move = (next: Point, z = zoom) => setOffset(clampOffset(picture, window169, z, next));
  const s = scale(picture, window169, zoom);

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
    <div ref={ref} className={styles.backdrop} data-leaving={leaving || undefined}>
      <div
        className={`glass ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-crop-title"
      >
        <h2 id="cover-crop-title" className={styles.title}>
          {title}
        </h2>
        <p className={styles.hint}>
          Trascina l'immagine e usa lo zoom: si tiene quello che si vede nel riquadro.
        </p>
        <div
          className={styles.window}
          style={{ width: window169.width, height: window169.height }}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys move the picture
          tabIndex={0}
          aria-label="Immagine da ritagliare: trascinala o usa le frecce"
          role="img"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <img
            src={picture.url}
            alt=""
            draggable={false}
            className={styles.image}
            style={{
              width: picture.width * s,
              height: picture.height * s,
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
            onClick={() => onSave(cropRect(picture, window169, zoom, offset))}
          >
            {saving ? "Salvo…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
