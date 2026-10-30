import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { avatarUrl } from "../../api/auth";
import type { Overview } from "../../api/overview";
import { useAccount } from "../../app/auth";
import { PageLoading } from "../../app/PageLoading";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { Icon, type IconName } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { BusyRing, LiveDot, ProgressBar } from "../../components/ProgressBar";
import { SiteName } from "../../components/SiteName";
import { richMotion } from "../../lib/richMotion";
import { ActivityProvider, downloadPercent, runningJobs, useActivity } from "./activity";
import styles from "./Console.module.css";
import { averagePercent, kindShort, workPercent } from "./jobText";
import { ui } from "./ui";

type Section = {
  to: string;
  label: string;
  icon: IconName;
  hint: string;
  count?: (o: Overview) => number;
};

// groups are the pages of the administration, in the order shown, put
// together by what they are about so the eye finds them at once.
export const groups: { title: string; sections: Section[] }[] = [
  {
    title: "",
    sections: [
      {
        to: "riepilogo",
        label: "Riepilogo",
        icon: "gauge",
        hint: "Cosa c'è da sistemare e i numeri del sito",
      },
    ],
  },
  {
    title: "Persone",
    sections: [
      {
        to: "persone",
        label: "Persone",
        icon: "people",
        hint: "Chi entra, chi carica video e con quanto spazio",
        count: (o) => o.people,
      },
      { to: "inviti", label: "Inviti", icon: "mail", hint: "Link per far entrare qualcuno" },
      { to: "accessi", label: "Accessi", icon: "key", hint: "Chi è entrato, quando e da dove" },
    ],
  },
  {
    title: "Contenuti",
    sections: [
      {
        to: "video",
        label: "Video",
        icon: "play",
        hint: "Titoli, copertine, anteprime e video nascosti",
        count: (o) => o.videos.present,
      },
      {
        to: "categorie",
        label: "Categorie",
        icon: "categories",
        hint: "Nomi, colori e immagini delle categorie",
        count: (o) => o.categories,
      },
      {
        to: "sottotitoli",
        label: "Sottotitoli",
        icon: "subtitles",
        hint: "Quali video li hanno, crearli e tradurli",
      },
      {
        to: "commenti",
        label: "Commenti",
        icon: "comment",
        hint: "Leggere e togliere i commenti",
        count: (o) => o.comments,
      },
    ],
  },
  {
    title: "Sistema",
    sections: [
      { to: "cartelle", label: "Cartelle", icon: "folder", hint: "Dove FranzPLAY cerca i video" },
      {
        to: "internet",
        label: "Internet",
        icon: "globe",
        hint: "Copertine e titoli presi da internet",
      },
      {
        to: "lavori",
        label: "Lavori",
        icon: "layers",
        hint: "Cosa sta preparando FranzPLAY",
      },
      {
        to: "sito",
        label: "Sito",
        icon: "settings",
        hint: "Nome, colore, registrazione e aggiornamenti",
      },
    ],
  },
];

const sections = groups.flatMap((g) => g.sections.map((s) => ({ ...s, group: g.title })));

// The console's own menu needs the room of a computer; below, the
// sections become a strip of chips over the page.
const wideQuery = "(min-width: 900px)";

// useWide says whether the console's menus fit beside the page, and
// follows the window when it changes size. Without matchMedia (tests) yes.
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(wideQuery).matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.(wideQuery);
    if (!media?.addEventListener) return;
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

// CrumbContext lets a page inside a page (one video) add its own name at
// the end of the path in the bar on top.
const CrumbContext = createContext<(name: string) => void>(() => {});

// useCrumb puts name at the end of the path on top while the page is open.
export function useCrumb(name: string) {
  const set = useContext(CrumbContext);
  useLayoutEffect(() => {
    set(name);
    return () => set("");
  }, [name, set]);
}

// AdminPage is the frame of the administration, a console: only the
// administrator sees it. On a computer: the app's icons in a narrow bar,
// the administration's own menu with what is at work at its foot, and the
// open page at full width under a bar with the path and the work going
// on. On a phone: the sections as chips over the page.
export function AdminPage() {
  usePageTitle("Amministrazione");
  const account = useAccount();
  if (account.role !== "admin") {
    return (
      <EmptyState title="Solo per l'amministratore" headingLevel={1}>
        Queste pagine servono a chi gestisce FranzPLAY.
      </EmptyState>
    );
  }
  return (
    <ActivityProvider>
      <Console />
    </ActivityProvider>
  );
}

function Console() {
  const { pathname } = useLocation();
  const wide = useWide();
  const [crumb, setCrumb] = useState("");
  const [going, setGoing] = useState(false);
  const rest = pathname.replace(/^\/admin\/?/, "");
  const open = sections.find((s) => rest === s.to || rest.startsWith(`${s.to}/`));
  const work = useRef<HTMLElement | null>(null);
  const opened = useRef(false);

  // A new page fades in where it is: nothing moves, the menus stay still.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fade runs on every new address
  useEffect(() => {
    // The first page comes in with the whole console (Layout).
    if (!opened.current) {
      opened.current = true;
      return;
    }
    const element = work.current;
    if (!element?.animate || !richMotion()) return;
    const fade = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
      easing: "ease-out",
    });
    return () => fade.cancel();
  }, [pathname]);

  // Ctrl K (⌘ K on a Mac) opens "Vai a…" from anywhere in the console.
  useEffect(() => {
    if (!wide) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setGoing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide]);

  if (!open) return <Navigate to="/admin/riepilogo" replace />;
  const inner = rest !== open.to;

  const page = (
    <CrumbContext.Provider value={setCrumb}>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
    </CrumbContext.Provider>
  );

  if (!wide) {
    return (
      <div className={`${styles.console} ${ui.ui}`}>
        <div className={styles.phoneBar}>
          <nav aria-label="Sezioni dell'amministrazione">
            <ChipsMenu />
          </nav>
          <div className={styles.phoneStatus}>
            <WorkPill />
          </div>
        </div>
        <div
          ref={(element) => {
            work.current = element;
          }}
          className={styles.work}
        >
          {page}
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.console} ${ui.ui}`}>
      <AppRail />
      <aside className={styles.nav} aria-label="Amministrazione">
        <div className={styles.navSite}>
          <span className={styles.navSiteName}>
            <SiteName accentClass={styles.navSiteAccent} />
          </span>
          <span className={styles.navSiteSub}>Console di amministrazione</span>
        </div>
        <button type="button" className={styles.goto} onClick={() => setGoing(true)}>
          <Icon name="search" size={16} />
          Vai a…
          <kbd className={styles.kbd}>Ctrl K</kbd>
        </button>
        <nav aria-label="Sezioni dell'amministrazione">
          <SideMenu />
        </nav>
        <div className={styles.navFoot}>
          <WorkCard />
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <ol className={styles.crumb} aria-label="Sei qui">
            {open.group && open.group !== open.label && <li>{open.group}</li>}
            <li>
              {inner ? (
                <Link to={`/admin/${open.to}`}>{open.label}</Link>
              ) : (
                <span aria-current="page">{open.label}</span>
              )}
            </li>
            {inner && crumb && (
              <li>
                <span aria-current="page">{crumb}</span>
              </li>
            )}
          </ol>
          <WorkPill />
        </header>
        <div
          ref={(element) => {
            work.current = element;
          }}
          className={styles.work}
        >
          {page}
        </div>
      </div>
      {going && <GoTo onClose={() => setGoing(false)} />}
    </div>
  );
}

// AppRail is the app's own menu, folded to its icons, so the whole site is
// one click away from the console.
function AppRail() {
  const account = useAccount();
  const links: { to: string; label: string; icon: IconName }[] = [
    { to: "/", label: "Home", icon: "home" },
    { to: "/categorie", label: "Categorie", icon: "categories" },
    { to: "/playlist", label: "Playlist", icon: "playlist" },
    { to: "/cronologia", label: "Cronologia", icon: "history" },
    { to: `/canale/${account.id}`, label: "Il mio canale", icon: "channel" },
  ];
  return (
    <nav className={styles.rail} aria-label="Menu dell'app">
      <Link to="/" className={styles.railLogo} aria-label="Home">
        <Icon name="play" size={15} />
      </Link>
      {links.map((l) => (
        <Link key={l.to} to={l.to} className={styles.railLink} aria-label={l.label}>
          <Icon name={l.icon} size={20} />
          <span className={styles.railTip} aria-hidden="true">
            {l.label}
          </span>
        </Link>
      ))}
      <span className={`${styles.railLink}`} data-here aria-label="Amministrazione" role="img">
        <Icon name="shield" size={20} />
      </span>
      <span className={styles.railSpacer} />
      <Link
        to="/profilo"
        className={`${styles.railLink} ${styles.railAvatar}`}
        aria-label="Il tuo profilo"
      >
        <Avatar name={account.name} size={36} photo={avatarUrl(account.id, account.avatar)} />
        <span className={styles.railTip} aria-hidden="true">
          Il tuo profilo
        </span>
      </Link>
    </nav>
  );
}

// SideMenu lists the sections by group, with how many things each holds
// and a live dot beside Lavori while something runs.
function SideMenu() {
  const { overview, working } = useActivity();
  return (
    <>
      {groups.map((g) => {
        // The title of a group is only seen: the lists stay without a
        // name, so they are not confused with the lists of the pages.
        return (
          <div key={g.title || "start"}>
            {g.title && <p className={styles.navTitle}>{g.title}</p>}
            <ul className={styles.navGroup}>
              {g.sections.map((s) => (
                <li key={s.to}>
                  <NavLink to={`/admin/${s.to}`} className={styles.navLink}>
                    <Icon name={s.icon} size={18} />
                    {s.label}
                    {s.to === "lavori" && working > 0 ? (
                      <span className={styles.navLive}>
                        <LiveDot />
                        {working}
                        <span className="visually-hidden"> in corso</span>
                      </span>
                    ) : (
                      s.count &&
                      overview && (
                        <span className={styles.navCount}>
                          {s.count(overview).toLocaleString("it-IT")}
                        </span>
                      )
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

// ChipsMenu is the menu on a phone: every section as a chip, the open one
// in white, scrolled into sight.
function ChipsMenu() {
  const list = useRef<HTMLUListElement>(null);
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: on every new section
  useEffect(() => {
    const here = list.current?.querySelector<HTMLElement>("[aria-current='page']");
    here?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [pathname]);
  return (
    <ul ref={list} className={styles.chips}>
      {sections.map((s) => (
        <li key={s.to}>
          <NavLink to={`/admin/${s.to}`} className={styles.chip}>
            <Icon name={s.icon} size={16} />
            {s.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

// WorkPill is the pill on top: how many things run now, with a small bar
// that fills as they go (the average of those that can tell; it only
// moves when none can); "Tutto fermo" when FranzPLAY rests. It opens Lavori.
function WorkPill() {
  const { jobs, active, download, working } = useActivity();
  const waiting = jobs?.waiting ?? 0;
  if (working === 0) {
    return (
      <Link to="/admin/lavori" className={styles.pill}>
        <Icon name="check" size={16} />
        {waiting > 0 ? `${waiting.toLocaleString("it-IT")} in coda` : "Tutto fermo"}
      </Link>
    );
  }
  const percent = jobs?.live
    ? averagePercent(active)
    : download && active.length === 0
      ? downloadPercent(download)
      : averagePercent(active);
  return (
    <Link to="/admin/lavori" className={styles.pill} data-busy>
      <BusyRing size={16} />
      <span>
        <b>{working}</b> {working === 1 ? "lavoro in corso" : "lavori in corso"}
        {percent !== null && <span className={styles.pillPercent}> · {Math.floor(percent)}%</span>}
      </span>
      <ProgressBar
        className={styles.pillBar}
        size="small"
        percent={percent}
        label="Lavori in corso"
      />
    </Link>
  );
}

// WorkCard is "Al lavoro" at the foot of the menu: each thing running now
// with its bar and percentage, and how many wait. It is always there, so a
// glance says whether FranzPLAY works or rests.
function WorkCard() {
  const { jobs, download, working } = useActivity();
  const running = runningJobs(jobs);
  const waiting = jobs?.waiting ?? 0;
  const failed = jobs?.failedTotal ?? 0;
  const titleId = useId();
  const downloadShown = download ? downloadPercent(download) : null;
  return (
    <section
      className={styles.actCard}
      data-busy={working > 0 || undefined}
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className={styles.actTitle}>
        {working > 0 ? <BusyRing size={16} /> : <Icon name="check" size={16} />}
        {working > 0 ? "Al lavoro" : "Tutto fermo"}
      </h2>
      {running.map((job) => {
        const percent = workPercent(job);
        return (
          <div key={job.id} className={styles.actRow}>
            <div className={styles.actRowHead}>
              <span>
                {kindShort[job.kind]} · {job.title}
              </span>
              {percent !== null && <b>{Math.floor(percent)}%</b>}
            </div>
            <ProgressBar
              size="small"
              percent={percent}
              label={`${kindShort[job.kind]} di ${job.title}`}
            />
          </div>
        );
      })}
      {download && (
        <div className={styles.actRow}>
          <div className={styles.actRowHead}>
            <span>Modello {download.name}</span>
            {downloadShown !== null && <b>{Math.floor(downloadShown)}%</b>}
          </div>
          <ProgressBar
            size="small"
            percent={downloadShown}
            label={`Scarico il modello ${download.name}`}
          />
        </div>
      )}
      {working === 0 && (
        <p className={styles.actQuiet}>
          {waiting > 0 ? `${waiting.toLocaleString("it-IT")} in coda.` : "Nessun lavoro in coda."}
        </p>
      )}
      <p className={styles.actFoot}>
        {waiting > 0 && working > 0 && `${waiting.toLocaleString("it-IT")} in coda · `}
        {failed > 0 && `${failed.toLocaleString("it-IT")} non riusciti · `}
        <Link to="/admin/lavori">Apri Lavori</Link>
      </p>
    </section>
  );
}

// GoTo is "Vai a…": a window where typing a few letters finds a section;
// Enter opens it, the arrows move between them, Esc closes.
function GoTo({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const listId = useId();
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.hint.toLowerCase().includes(q) ||
        s.group.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal?.();
  }, []);

  const go = useCallback(
    (to: string) => {
      onClose();
      navigate(`/admin/${to}`);
    },
    [navigate, onClose],
  );

  return (
    <dialog
      ref={dialog}
      className={styles.goDialog}
      aria-label="Vai a una sezione"
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAt((i) => Math.min(found.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setAt((i) => Math.max(0, i - 1));
        } else if (e.key === "Enter" && found[at]) {
          e.preventDefault();
          go(found[at].to);
        } else if (e.key === "Escape") {
          onClose();
        }
      }}
    >
      <label className={styles.goField}>
        <Icon name="search" size={18} />
        <span className="visually-hidden">Cerca una sezione</span>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={found[at] ? `${listId}-${found[at].to}` : undefined}
          placeholder="Vai a… persone, video, sottotitoli"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
        />
      </label>
      {found.length === 0 ? (
        <p className={styles.goNone}>Nessuna sezione con queste parole.</p>
      ) : (
        <div id={listId} role="listbox" className={styles.goList} aria-label="Sezioni">
          {found.map((s, i) => (
            <button
              key={s.to}
              id={`${listId}-${s.to}`}
              type="button"
              role="option"
              aria-selected={i === at}
              className={styles.goItem}
              onMouseEnter={() => setAt(i)}
              onClick={() => go(s.to)}
            >
              <Icon name={s.icon} size={18} />
              <span className={styles.goText}>
                <b>{s.label}</b>
                <span>{s.hint}</span>
              </span>
              {s.group && <span className={styles.goGroup}>{s.group}</span>}
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}
