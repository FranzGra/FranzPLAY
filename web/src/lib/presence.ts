import { type RefObject, useLayoutEffect, useRef, useState } from "react";

// safetyTime is the longest a leaving move may take: if the browser never
// says it ended (a hidden tab, say), the element goes anyway.
const safetyTime = 600; // milliseconds

export type Presence<T, E extends HTMLElement> = {
  // shown is what to draw: the value, or the last one while it leaves.
  shown: T | null;
  // leaving is true while the element plays its leaving move.
  leaving: boolean;
  // ref goes on the element that moves.
  ref: RefObject<E | null>;
};

// usePresence keeps something on the page while it plays its leaving move,
// so menus and windows close as softly as they open. Give it what to show,
// or null for nothing. While it leaves, put data-leaving on the element:
// its CSS gives it a leaving animation, like var(--motion-pop-out). With
// no animation (less motion, or in tests) it goes at once.
export function usePresence<T, E extends HTMLElement = HTMLDivElement>(
  value: T | null,
): Presence<T, E> {
  const ref = useRef<E>(null);
  const [shown, setShown] = useState<T | null>(value);
  // A new value shows at once. (Changing our own state while drawing is
  // allowed: React draws again straight away.)
  if (value !== null && value !== shown) setShown(value);
  const leaving = value === null && shown !== null;

  useLayoutEffect(() => {
    if (!leaving) return;
    const element = ref.current;
    const gone = () => setShown(null);
    if (!element || !animates(element)) {
      gone();
      return;
    }
    const onEnd = (event: AnimationEvent) => {
      if (event.target === element) gone();
    };
    element.addEventListener("animationend", onEnd);
    const timer = window.setTimeout(gone, safetyTime);
    return () => {
      element.removeEventListener("animationend", onEnd);
      window.clearTimeout(timer);
    };
  }, [leaving]);

  return { shown, leaving, ref };
}

// animates says whether the element is playing a CSS animation.
function animates(element: HTMLElement): boolean {
  const name = window.getComputedStyle(element).animationName;
  return name !== "" && name !== "none";
}
