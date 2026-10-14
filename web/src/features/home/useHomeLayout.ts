import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultHomeLook,
  fetchHomeLayout,
  type HomeLook,
  type HomeRow,
  setHomeLook,
  setRowOpen,
} from "../../api/home";

// Fold is what a row needs to open and close.
export type Fold = { open: boolean; onToggle: () => void };

type State = { kind: "loading" } | { kind: "ready"; closed: HomeRow[]; look: HomeLook };

// lookSaveDelay is how long the Home waits after the last change of the
// look before keeping it: a slider sends many changes while it moves.
const lookSaveDelay = 500;

// useHomeLayout loads which rows the person closed and how they like the
// cards. Until it is known the rows wait, so a closed row does not flash
// open. If it does not load, every row is open with the usual cards: the
// Home still works.
export function useHomeLayout() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHomeLayout(controller.signal)
      .then(({ closed, look }) => setState({ kind: "ready", closed, look }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "ready", closed: [], look: defaultHomeLook });
      });
    return () => controller.abort();
  }, []);

  const fold = useCallback(
    (row: HomeRow): Fold => {
      const closed = state.kind === "ready" && state.closed.includes(row);
      return {
        open: !closed,
        onToggle: () => {
          // The row moves at once; the server keeps the choice. If it
          // cannot, the row stays as chosen for now and the next visit
          // shows it as before.
          setState((s) =>
            s.kind !== "ready"
              ? s
              : {
                  ...s,
                  closed: closed ? s.closed.filter((r) => r !== row) : [...s.closed, row],
                },
          );
          setRowOpen(row, closed).catch((error: unknown) => console.error(error));
        },
      };
    },
    [state],
  );

  const setLook = useLookSaver(setState);

  return {
    ready: state.kind === "ready",
    look: state.kind === "ready" ? state.look : defaultHomeLook,
    fold,
    setLook,
  };
}

// useLookSaver changes the look at once and keeps it on the server a
// moment after the last change. Leaving the Home keeps what is waiting.
function useLookSaver(setState: (change: (s: State) => State) => void) {
  const waiting = useRef<{ look: HomeLook; timer: ReturnType<typeof setTimeout> } | null>(null);

  const save = useCallback(() => {
    const w = waiting.current;
    if (!w) return;
    clearTimeout(w.timer);
    waiting.current = null;
    setHomeLook(w.look).catch((error: unknown) => console.error(error));
  }, []);

  useEffect(() => save, [save]);

  return useCallback(
    (look: HomeLook) => {
      setState((s) => (s.kind === "ready" ? { ...s, look } : s));
      if (waiting.current) clearTimeout(waiting.current.timer);
      waiting.current = { look, timer: setTimeout(save, lookSaveDelay) };
    },
    [save, setState],
  );
}
