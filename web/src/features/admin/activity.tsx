import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchSubtitlesSetup, type ModelDownload } from "../../api/autosubs";
import { onServerEvent } from "../../api/events";
import { type ActiveWork, fetchJobs, type Job, type JobsOverview } from "../../api/jobs";
import { fetchOverview, type Overview } from "../../api/overview";

// Activity is what FranzPLAY is doing now, as every page of the
// administration shows it: the menu's "Al lavoro" box, the "N lavori in
// corso" pill on top, the dot beside Lavori, the Riepilogo.
export type Activity = {
  jobs: JobsOverview | null; // null until the first answer, or when it fails
  // active is all the work going on now: the jobs of the queue that run,
  // with how far they are, and the download of a model.
  active: ActiveWork[];
  // download is the whisper model being downloaded now; null when none is.
  download: ModelDownload | null;
  // working is how many things run now.
  working: number;
  overview: Overview | null; // the numbers beside the menu; null until they come
  overviewFailed: boolean;
  refresh: () => void; // ask again now, after an action
};

const empty: Activity = {
  jobs: null,
  active: [],
  download: null,
  working: 0,
  overview: null,
  overviewFailed: false,
  refresh: () => {},
};

const ActivityContext = createContext<Activity>(empty);

// useActivity reads what FranzPLAY is doing now. Outside the frame of the
// administration (a page tested alone) nothing runs.
export function useActivity(): Activity {
  return useContext(ActivityContext);
}

// While something runs the numbers move without the server saying so (an
// older server, or the events cut by a proxy): the frame asks again this
// often, and stops when all rests.
export const pollEvery = 2500;

// The numbers beside the menu (videos, disks) change slowly: while the
// queue moves they are asked again at most this often.
const overviewEvery = 3000;

// throttle runs fn at once, then at most once every ms: calls in between
// make one more run when the pause ends, so the last change is never lost.
export function throttle(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let last = 0;
  let timer: number | undefined;
  const run = () => {
    timer = undefined;
    last = Date.now();
    fn();
  };
  return {
    call() {
      if (timer !== undefined) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) run();
      else timer = window.setTimeout(run, wait);
    },
    cancel() {
      window.clearTimeout(timer);
      timer = undefined;
    },
  };
}

// downloadFrom reads a model download from the work going on: the server
// sends its bytes in doneSeconds and totalSeconds.
export function downloadFrom(w: ActiveWork): ModelDownload {
  const done = w.doneSeconds ?? 0;
  return {
    name: w.title,
    done,
    total: w.totalSeconds ?? 0,
    error: "",
    ended: false,
    canceled: false,
    startedAt: w.startedAt,
    endedAt: null,
    speed: w.seconds && w.seconds > 0 ? done / w.seconds : 0,
  };
}

// runningJobs are the jobs of the queue running now (not the download).
export function runningJobs(jobs: JobsOverview | null): Job[] {
  if (!jobs) return [];
  if (!jobs.live) return jobs.running ? [jobs.running] : [];
  return jobs.active.filter((w): w is Job => w.kind !== "model");
}

// ActivityProvider follows the queue of work and the download of whisper
// models for the whole administration: once, for every page. It asks
// again when the server says the queue changed, and while something runs.
export function ActivityProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobsOverview | null>(null);
  const [oldDownload, setOldDownload] = useState<ModelDownload | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const again = useRef(false);

  // load asks one question at a time. While an answer is on its way, a new
  // change only asks for one more question after it: with a busy server
  // (whisper at work) stopping the old question to ask a new one would mean
  // that no answer ever arrives, and the bars stand still.
  const load = useCallback(function ask() {
    if (controller.current) {
      again.current = true;
      return;
    }
    const c = new AbortController();
    controller.current = c;
    fetchJobs(c.signal)
      .then((j) => {
        setJobs(j);
        // A newer server tells the download with the queue; an older one
        // only in whisper's setup, asked separately.
        if (j.live) return;
        fetchSubtitlesSetup(c.signal)
          .then((setup) =>
            setOldDownload(setup.download && !setup.download.ended ? setup.download : null),
          )
          .catch(() => {
            // Without whisper's setup there is simply no download to show.
            if (!c.signal.aborted) setOldDownload(null);
          });
      })
      .catch((error: unknown) => {
        if (!c.signal.aborted) console.error(error);
      })
      .finally(() => {
        if (controller.current !== c) return; // the page went away meanwhile
        controller.current = null;
        if (again.current) {
          again.current = false;
          ask();
        }
      });
  }, []);

  const loadOverview = useCallback((signal?: AbortSignal) => {
    fetchOverview(signal)
      .then((o) => {
        setOverview(o);
        setOverviewFailed(false);
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        console.error(error);
        setOverviewFailed(true);
      });
  }, []);

  useEffect(() => {
    const c = new AbortController();
    const overviewSoon = throttle(() => loadOverview(c.signal), overviewEvery);
    load();
    overviewSoon.call();
    // The queue's bars move up to twice a second: the queue is asked again
    // each time, the numbers beside the menu more calmly.
    const stopJobs = onServerEvent("jobs", () => {
      load();
      overviewSoon.call();
    });
    const stopLibrary = onServerEvent("library", overviewSoon.call);
    return () => {
      stopJobs();
      stopLibrary();
      overviewSoon.cancel();
      c.abort();
      controller.current?.abort();
      controller.current = null;
      again.current = false;
    };
  }, [load, loadOverview]);

  const live = jobs?.live ?? false;
  const active = useMemo<ActiveWork[]>(() => {
    if (!jobs) return [];
    if (live) return jobs.active;
    return jobs.running ? [jobs.running] : [];
  }, [jobs, live]);
  const download = useMemo<ModelDownload | null>(() => {
    if (!live) return oldDownload;
    const model = active.find((w) => w.kind === "model");
    return model ? downloadFrom(model) : null;
  }, [live, active, oldDownload]);
  const working = live ? active.length : active.length + (download ? 1 : 0);

  // While something runs, ask again every little while: the bars move
  // even when the server's events do not come.
  useEffect(() => {
    if (working === 0) return;
    const timer = window.setInterval(load, pollEvery);
    return () => window.clearInterval(timer);
  }, [working, load]);

  const refresh = useCallback(() => {
    load();
    loadOverview();
  }, [load, loadOverview]);

  const value = useMemo<Activity>(
    () => ({ jobs, active, download, working, overview, overviewFailed, refresh }),
    [jobs, active, download, working, overview, overviewFailed, refresh],
  );
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

// downloadPercent is how much of a download is done, or null while its
// size is not known yet.
export function downloadPercent(d: ModelDownload): number | null {
  return d.total > 0 ? (100 * d.done) / d.total : null;
}

// downloadLeft guesses how many seconds a download still takes, from its
// speed; null when it cannot tell.
export function downloadLeft(d: ModelDownload): number | null {
  if (d.speed <= 0 || d.total <= 0) return null;
  return Math.max(0, (d.total - d.done) / d.speed);
}
