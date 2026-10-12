import { useCallback, useEffect, useState } from "react";
import { fetchHomeLayout, type HomeRow, setRowOpen } from "../../api/home";

// Fold is what a row needs to open and close.
export type Fold = { open: boolean; onToggle: () => void };

type State = { kind: "loading" } | { kind: "ready"; closed: HomeRow[] };

// useHomeLayout loads which rows the person closed. Until it is known the
// rows wait, so a closed row does not flash open. If it does not load,
// every row is open: the Home still works.
export function useHomeLayout() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHomeLayout(controller.signal)
      .then(({ closed }) => setState({ kind: "ready", closed }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "ready", closed: [] });
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
                  kind: "ready",
                  closed: closed ? s.closed.filter((r) => r !== row) : [...s.closed, row],
                },
          );
          setRowOpen(row, closed).catch((error: unknown) => console.error(error));
        },
      };
    },
    [state],
  );

  return { ready: state.kind === "ready", fold };
}
