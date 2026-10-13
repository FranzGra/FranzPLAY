import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";

// How long the pointer rests on a card before its clip plays: moving the
// mouse across the grid does not start every clip on the way. A full
// second, as Francesco asked: only a card the person stops on plays.
export const hoverDelay = 1000; // milliseconds
// How long the page must stay still on a touch screen before the card in
// the middle plays: a finger flicking through the list starts nothing.
export const settleDelay = 600; // milliseconds
// How much of a cover must be on screen, across and down, for its clip to
// play by itself on a touch screen.
const visibleEnough = 0.6;

// Only one clip plays at a time, on the whole page: starting one stops
// the one before.
let stopPlaying: (() => void) | null = null;

// useClipPreview plays a video's clip on its card. With a mouse, when it
// rests on the card. On a touch screen there is nothing resting on a card,
// and a finger on it is scrolling: so, as on YouTube for phones, the card
// left in the middle of the screen when the page stops plays by itself.
// It gives back whether the clip should show, the handlers for the card
// and a ref for its cover, which is what the middle of the screen is
// measured against. by itself false keeps a card out of that, like the
// small ones beside the player, which must not move while a video plays.
export function useClipPreview(clip: string | null, byItself = true) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const [cover, setCover] = useState<HTMLElement | null>(null);

  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    setPlaying(false);
  }, []);

  const start = useCallback(() => {
    if (stopPlaying !== stop) stopPlaying?.();
    stopPlaying = stop;
    setPlaying(true);
  }, [stop]);

  // A card that goes away stops its clip and forgets its timer.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (stopPlaying === stop) stopPlaying = null;
    },
    [stop],
  );

  // On a touch screen the card takes part in "who is in the middle".
  useEffect(() => {
    if (clip === null || cover === null || !byItself || !touchScreen()) return;
    return watchMiddle({ cover, start, stop });
  }, [clip, cover, byItself, start, stop]);

  if (clip === null) {
    return { playing: false, handlers: {}, coverRef: setCover };
  }

  const handlers = {
    onPointerEnter(e: PointerEvent) {
      if (e.pointerType !== "mouse") return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(start, hoverDelay);
    },
    onPointerLeave(e: PointerEvent) {
      if (e.pointerType === "mouse") stop();
    },
  };
  return { playing, handlers, coverRef: setCover };
}

// touchScreen says whether the main pointer is a finger: a phone or a
// tablet, where nothing can rest on a card.
function touchScreen(): boolean {
  return window.matchMedia?.("(hover: none)").matches ?? false;
}

type Card = { cover: HTMLElement; start: () => void; stop: () => void };

// The cards on the page that can play by themselves, and the one playing.
const cards = new Set<Card>();
let playingCard: Card | null = null;
let settleTimer: number | undefined;

// watchMiddle adds a card to those that can play by themselves, and gives
// back how to take it away. The first card starts listening to the page,
// the last one stops.
function watchMiddle(card: Card): () => void {
  if (cards.size === 0) {
    // Scrolling anywhere counts, also a row of cards sliding sideways:
    // scroll events do not bubble, but they can be caught on the way down.
    document.addEventListener("scroll", settleSoon, { capture: true, passive: true });
    window.addEventListener("resize", settleSoon);
  }
  cards.add(card);
  settleSoon(); // a page that just opened plays its middle card too
  return () => {
    cards.delete(card);
    if (playingCard === card) playingCard = null;
    if (cards.size === 0) {
      window.clearTimeout(settleTimer);
      document.removeEventListener("scroll", settleSoon, { capture: true });
      window.removeEventListener("resize", settleSoon);
    }
  };
}

// settleSoon waits for the page to stay still, then plays the middle card.
function settleSoon() {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(playMiddle, settleDelay);
}

function playMiddle() {
  const screen = { width: window.innerWidth, height: window.innerHeight };
  const boxes = Array.from(cards, (card) =>
    // A closed section still has its cards, folded away out of reach.
    card.cover.closest("[inert]") ? hidden : card.cover.getBoundingClientRect(),
  );
  const index = middleCard(boxes, screen);
  const next = index === null ? null : (Array.from(cards)[index] ?? null);
  if (next === playingCard) return;
  playingCard?.stop();
  playingCard = next;
  next?.start();
}

type Box = { left: number; top: number; width: number; height: number };
const hidden: Box = { left: 0, top: 0, width: 0, height: 0 };

// middleCard picks, among the covers on the page, the one to play on a
// touch screen: the closest to the middle of the screen among those well
// in view. null: none is in view enough.
export function middleCard(
  covers: Box[],
  screen: { width: number; height: number },
): number | null {
  const middle = { x: screen.width / 2, y: screen.height / 2 };
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  covers.forEach((box, i) => {
    if (box.width <= 0 || box.height <= 0) return; // hidden, like a closed section
    const across = Math.min(box.left + box.width, screen.width) - Math.max(box.left, 0);
    const down = Math.min(box.top + box.height, screen.height) - Math.max(box.top, 0);
    if (across < box.width * visibleEnough || down < box.height * visibleEnough) return;
    const distance = Math.hypot(
      box.left + box.width / 2 - middle.x,
      box.top + box.height / 2 - middle.y,
    );
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}
