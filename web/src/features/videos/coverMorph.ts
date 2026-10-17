import { canMorphPages } from "../../lib/richMotion";

// The cover of a video card grows into the player when the video opens,
// and shrinks back into its card on the way back, with the browser's view
// transitions: the browser takes a picture of the page before and after,
// and moves between the two, so nothing is laid out again while it moves.
//
// It is only a gift. Where the browser has no view transitions, or the
// device should not get big moves (richMotion), the card is a plain link
// and the page changes at once: same pages, same addresses, no errors.
//
// How the names work: a view transition pairs the elements that carry the
// same view-transition-name before and after, and gives up if two carry
// the same name at once. The player always has the name video-player (in
// VideoPage.module.css, for theater mode). So only the cover clicked gets
// it, only for the picture "before", while the player of the video being
// left (opening a suggestion) loses it for that picture.

// data-morph on <html> is set while a card morph runs, so CSS can time it
// and the rest of the page can skip its own entrance.
const MORPH = "morph";
// data-morph-before is set only while the browser takes the picture
// "before": the player being left, its title and its column lose their
// names then (VideoPage.module.css).
const BEFORE = "morphBefore";
// The name the player and the cover share.
export const PLAYER_NAME = "video-player";
// The name the player and its card share on the way back. It is not the
// player's usual name, because the page we go back to can be another
// video, whose own player keeps video-player.
const BACK_NAME = "video-back";

// How long a click waits for the player's code before going anyway, and
// how long the browser waits for the new page before taking its picture.
export const CODE_WAIT_MS = 300;
const PAGE_WAIT_MS = 400;
const BACK_WAIT_MS = 350;

// opened remembers the card the last video was opened from: which video,
// and which of the covers of that video on the page (one video can be in
// two rows), so the way back finds the same one.
let opened: { video: number; index: number } | null = null;
// watching is the video on screen, set by its page.
let watching: number | null = null;

export function setWatching(video: number | null): void {
  watching = video;
}

export function morphing(): boolean {
  return document.documentElement.dataset[MORPH] !== undefined;
}

// plainClick says whether a click on a link is an ordinary one: the left
// button, no key held. Ctrl, Cmd, Shift, Alt and the middle button open
// new tabs or windows, which the browser does by itself.
export function plainClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((done) => window.setTimeout(done, ms));
}

// until checks ready every few milliseconds until it says yes, or ms
// pass. Not on every frame: while the browser holds the picture of a view
// transition it draws no frames, and requestAnimationFrame waits too.
function until<T>(ready: () => T | null | undefined, ms: number): Promise<T | null> {
  const end = performance.now() + ms;
  return new Promise((done) => {
    const check = () => {
      const found = ready();
      if (found) done(found);
      else if (performance.now() >= end) done(null);
      else window.setTimeout(check, 16);
    };
    check();
  });
}

// settled waits, for at most ms, until find returns an element that kept
// the same place and size for three checks in a row.
async function settled(find: () => HTMLElement | null, ms: number): Promise<boolean> {
  let last = "";
  let same = 0;
  const found = await until(() => {
    const box = find()?.getBoundingClientRect();
    if (!box) return null;
    const now = `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`;
    same = now === last ? same + 1 : 0;
    last = now;
    return same >= 2 ? true : null;
  }, ms);
  return found === true;
}

// frameOf is the box of the player of a video, once its page is drawn.
function frameOf(video: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-video-frame="${video}"]`);
}

function coversOf(video: number): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-card-video="${video}"]`)];
}

// onScreen says whether at least a good part of an element is visible.
function onScreen(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return false;
  const visible =
    Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0) > box.height / 3 &&
    Math.min(box.right, window.innerWidth) - Math.max(box.left, 0) > box.width / 3;
  return visible;
}

// run starts a view transition and makes sure that, whatever happens to
// it (the browser can skip it), no error reaches the console and the
// page is cleaned up. If the browser refuses it, update runs at once.
// The transition running now, so its update can give it up.
let current: ViewTransition | null = null;

function run(update: () => Promise<void>, cleanup: () => void): void {
  const root = document.documentElement;
  root.dataset[MORPH] = "";
  const done = () => {
    delete root.dataset[MORPH];
    delete root.dataset[BEFORE];
    cleanup();
  };
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(update);
    current = transition;
  } catch {
    done();
    void update();
    return;
  }
  transition.ready.catch(() => {});
  transition.updateCallbackDone.catch(() => {});
  transition.finished.then(done, done);
  const forget = () => {
    if (current === transition) current = null;
  };
  transition.finished.then(forget, forget);
}

// openVideo opens a video from the cover of its card. It returns false
// when it does nothing, so the link opens the page as usual.
export async function openVideo(
  cover: HTMLElement,
  video: number,
  go: () => void,
  loadCode: () => Promise<unknown>,
): Promise<void> {
  // The player's code was usually fetched when the card was pointed at
  // (or by the home page, when the browser was idle). On the very first
  // click it may still be on its way: it gets a moment, and if it is not
  // there by then the page opens plainly, at once. A morph whose new page
  // is not ready would only fade the page across, with no cover moving,
  // and look like a much faster, different animation.
  const codeReady = await Promise.race([
    loadCode().then(
      () => true,
      () => false,
    ),
    wait(CODE_WAIT_MS).then(() => false),
  ]);
  if (!codeReady) {
    go();
    return;
  }
  if (!cover.isConnected) {
    go();
    return;
  }
  opened = { video, index: Math.max(0, coversOf(video).indexOf(cover)) };
  const root = document.documentElement;
  root.dataset[BEFORE] = "";
  cover.style.viewTransitionName = PLAYER_NAME;
  run(
    async () => {
      // The picture "before" is taken: from now on only the new player
      // has the name.
      cover.style.viewTransitionName = "";
      delete root.dataset[BEFORE];
      go();
      // A new page starts from its top.
      window.scrollTo(0, 0);
      // Then wait until the player stays in its place: the frame around
      // the page can still be moving (the side menu closing), and the
      // browser's picture must show the player where it will stay.
      if (!(await settled(() => frameOf(video), PAGE_WAIT_MS))) {
        // The player did not arrive in time: show the new page at once
        // rather than a fade without the cover.
        current?.skipTransition();
      }
    },
    () => {
      cover.style.viewTransitionName = "";
    },
  );
}

// canOpenWithMorph says whether openVideo should handle a click.
export function canOpenWithMorph(event: Parameters<typeof plainClick>[0]): boolean {
  return plainClick(event) && canMorphPages();
}

// backMorph is the way back from a video to the page it was opened from:
// the player shrinks into the card it came from, if that card is still
// there and on the screen after the page scrolls back to its place;
// otherwise the player only fades away. restoreScroll puts the page back
// where it was; navigate lets the router draw the page.
async function backMorph(navigate: () => void, restoreScroll: () => void): Promise<void> {
  const from = watching;
  const card = opened;
  const player = from === null ? null : frameOf(from);
  if (player) player.style.viewTransitionName = BACK_NAME;
  let target: HTMLElement | null = null;
  run(
    async () => {
      navigate();
      // Wait until the router has drawn the page we go back to (the
      // player we left is gone), then give its cards a moment to arrive.
      await until(() => (player?.isConnected ? null : true), BACK_WAIT_MS);
      if (player) player.style.viewTransitionName = "";
      restoreScroll();
      if (card === null || card.video !== from) return;
      // The lists of the page arrive a moment later: until the card is
      // there and the page long enough to scroll back to it, try again.
      const pick = () => {
        const covers = coversOf(card.video);
        return covers[card.index] ?? covers[0] ?? null;
      };
      target = await until(() => {
        restoreScroll();
        const cover = pick();
        return cover && onScreen(cover) ? cover : null;
      }, BACK_WAIT_MS);
      if (target && onScreen(target)) {
        target.style.viewTransitionName = BACK_NAME;
      } else {
        target = null;
      }
    },
    () => {
      if (player) player.style.viewTransitionName = "";
      if (target) target.style.viewTransitionName = "";
    },
  );
}

// installBackMorph listens for the browser's back and forward buttons
// before the router does. Leaving a video for another page, it holds the
// event back and gives it to the router inside a view transition. It must
// run before the router starts. restoreScroll is called with the address
// we arrive at, once its page is drawn.
export function installBackMorph(restoreScroll: () => void): void {
  let replaying = false;
  window.addEventListener(
    "popstate",
    (event) => {
      if (replaying || watching === null || !canMorphPages()) return;
      // Going to another video's page (forward, or back to the video a
      // suggestion was opened from) is not the way back to a card.
      if (location.pathname === `/video/${watching}`) return;
      event.stopImmediatePropagation();
      const state = event.state as unknown;
      void backMorph(() => {
        replaying = true;
        try {
          window.dispatchEvent(new PopStateEvent("popstate", { state }));
        } finally {
          replaying = false;
        }
      }, restoreScroll);
    },
    { capture: true },
  );
}

// forgetForTests resets what this module remembers, between tests.
export function forgetForTests(): void {
  opened = null;
  watching = null;
}
