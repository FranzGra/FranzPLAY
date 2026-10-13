import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// How long the pointer rests on a card before its clip plays: moving the
// mouse across the grid does not start every clip on the way. A full
// second, as Francesco asked: only a card the person stops on plays.
export const hoverDelay = 1000; // milliseconds
// How long a finger presses a card before its clip plays. A quicker tap
// opens the video, as always.
export const pressDelay = 400; // milliseconds
// How far a finger may move and still be pressing, not scrolling.
const pressSlack = 10; // pixels

// Only one clip plays at a time, on the whole page: starting one stops
// the one before.
let stopPlaying: (() => void) | null = null;

// useClipPreview plays a video's clip on its card: when the mouse rests
// on it, or when a finger presses it for a moment. It gives back whether
// the clip should show, and the handlers for the card.
export function useClipPreview(clip: string | null) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const pressed = useRef(false); // the last press started the clip

  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    setPlaying(false);
  }, []);

  const startSoon = useCallback(
    (delay: number, then?: () => void) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (stopPlaying !== stop) stopPlaying?.();
        stopPlaying = stop;
        setPlaying(true);
        then?.();
      }, delay);
    },
    [stop],
  );

  // A card that goes away stops its clip and forgets its timer.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (stopPlaying === stop) stopPlaying = null;
    },
    [stop],
  );

  if (clip === null) {
    return { playing: false, handlers: {} };
  }

  const handlers = {
    onPointerEnter(e: PointerEvent) {
      if (e.pointerType === "mouse") startSoon(hoverDelay);
    },
    onPointerLeave(e: PointerEvent) {
      if (e.pointerType === "mouse") stop();
    },
    onPointerDown(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      pressed.current = false;
      pressedAt.current = { x: e.clientX, y: e.clientY };
      startSoon(pressDelay, () => {
        pressed.current = true;
      });
    },
    onPointerMove(e: PointerEvent) {
      const at = pressedAt.current;
      if (e.pointerType !== "touch" || at === null) return;
      if (Math.hypot(e.clientX - at.x, e.clientY - at.y) > pressSlack) {
        pressedAt.current = null;
        window.clearTimeout(timer.current); // scrolling, not pressing
      }
    },
    onPointerUp(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      pressedAt.current = null;
      window.clearTimeout(timer.current); // a quick tap: the video opens
    },
    onPointerCancel(e: PointerEvent) {
      if (e.pointerType !== "touch") return;
      pressedAt.current = null;
      window.clearTimeout(timer.current);
    },
    // After a press the clip keeps playing: the finger lifting must not
    // also open the video.
    onClick(e: MouseEvent) {
      if (pressed.current) {
        pressed.current = false;
        e.preventDefault();
      }
    },
    // A long press on a phone opens the menu of the link: the clip takes
    // its place.
    onContextMenu(e: MouseEvent) {
      if (pressedAt.current !== null || pressed.current) e.preventDefault();
    },
  };
  return { playing, handlers };
}
