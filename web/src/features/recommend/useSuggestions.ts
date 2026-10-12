import { useEffect, useState } from "react";
import type { Suggestion } from "../../api/recommend";

const none: Suggestion[] = [];

// useSuggestions loads a list of suggested videos, again whenever load
// changes. Suggestions are a bonus: if they do not load, the list stays
// empty and the failure only goes to the console.
export function useSuggestions(load: (signal: AbortSignal) => Promise<Suggestion[]>): Suggestion[] {
  const [list, setList] = useState<Suggestion[]>(none);
  useEffect(() => {
    const controller = new AbortController();
    setList(none);
    load(controller.signal)
      .then(setList)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [load]);
  return list;
}
