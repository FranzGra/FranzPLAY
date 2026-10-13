import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { avatarUrl } from "../api/auth";
import { fetchPlaylists, onPlaylistsChanged, type Playlist, playlistName } from "../api/playlists";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { SiteName } from "../components/SiteName";
import { useAccount } from "./auth";
import styles from "./Layout.module.css";
import { type PageWidth, PageWidthContext } from "./pageWidth";

// sideLinks are the first links of the side menu; the channel is mine.
function sideLinks(me: number) {
  return [
    { to: "/", label: "Home", icon: "home" },
    { to: "/cronologia", label: "Cronologia", icon: "history" },
    { to: "/mi-piace", label: "Mi piace", icon: "like" },
    { to: "/condivisi", label: "Condivisi con te", icon: "share" },
    { to: "/categorie", label: "Categorie", icon: "categories" },
    { to: `/canale/${me}`, label: "Il mio canale", icon: "channel" },
  ] as const;
}

// The tabs of the phone bar. Each one also lights up on the pages reached
// from it, so on a phone it is clear where you are: the history, the upload
// and the administration open from the Profile page, for instance.
const tabs = [
  { to: "/", label: "Home", icon: "home", also: ["/cerca"] },
  { to: "/categorie", label: "Categorie", icon: "categories", also: [] },
  { to: "/playlist", label: "Playlist", icon: "playlist", also: ["/mi-piace", "/condivisi"] },
  {
    to: "/profilo",
    label: "Profilo",
    icon: "profile",
    also: ["/cronologia", "/carica", "/admin"],
  },
] as const;

// tabFor says which tab of the phone bar a page belongs to: its index, or
// null for a page of no tab, like a video.
export function tabFor(path: string): number | null {
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  const i = tabs.findIndex((tab) =>
    tab.to === "/" ? path === "/" || tab.also.some(under) : [tab.to, ...tab.also].some(under),
  );
  return i === -1 ? null : i;
}

// Layout is the frame around every page: top bar, side menu on computers,
// bottom bar with four tabs on phones.
export function Layout() {
  const navigate = useNavigate();
  const account = useAccount();
  const lists = useMyPlaylists();
  // "Guarda più tardi" comes first, then "Tutte le playlist", then the
  // lists I made.
  const later = lists.filter((list) => list.kind === "later");
  const mine = lists.filter((list) => list.kind !== "later");
  const [query, setQuery] = useState("");
  const page = useRef<HTMLDivElement>(null);
  useEnterOnNavigate(page);
  const currentTab = tabFor(useLocation().pathname);
  const [width, setWidth] = useState<PageWidth>("normal");

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (q) {
      navigate(`/cerca?q=${encodeURIComponent(q)}`);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>
          <span className={styles.logoMark}>
            <Icon name="play" size={14} />
          </span>
          <SiteName accentClass={styles.logoAccent} />
        </Link>

        <search className={styles.search}>
          <form onSubmit={onSearch}>
            <label className={`glass ${styles.searchBox}`}>
              <Icon name="search" size={18} />
              <span className="visually-hidden">Cerca</span>
              <input
                type="search"
                placeholder="Cerca video e persone"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </form>
        </search>

        <Link to="/cerca" className={styles.searchIcon} aria-label="Cerca">
          <Icon name="search" />
        </Link>

        <Link to="/profilo" className={styles.avatar} aria-label="Il tuo profilo">
          <Avatar name={account.name} size={40} photo={avatarUrl(account.id, account.avatar)} />
        </Link>
      </header>

      <div className={styles.body} data-width={width}>
        <nav className={styles.sidebar} aria-label="Menu principale">
          {sideLinks(account.id).map((link) => (
            <NavLink key={link.to} to={link.to} end className={styles.sideLink}>
              <Icon name={link.icon} size={20} />
              {link.label}
            </NavLink>
          ))}
          <div className={styles.sideHeading}>Le tue playlist</div>
          {later.map((list) => (
            <PlaylistLink key={list.id} list={list} />
          ))}
          <NavLink to="/playlist" end className={styles.sideLink}>
            <Icon name="playlist" size={20} />
            Tutte le playlist
          </NavLink>
          {mine.map((list) => (
            <PlaylistLink key={list.id} list={list} />
          ))}
          {account.role === "admin" && (
            <>
              <div className={styles.sideHeading}>Gestione</div>
              <NavLink to="/admin" className={styles.sideLink}>
                <Icon name="shield" size={20} />
                Amministrazione
              </NavLink>
            </>
          )}
        </nav>

        <main className={styles.main}>
          <div ref={page} className={styles.page}>
            <PageWidthContext.Provider value={setWidth}>
              <Outlet />
            </PageWidthContext.Provider>
          </div>
        </main>
      </div>

      <nav className={`glass ${styles.tabbar}`} aria-label="Menu del telefono">
        {tabs.map((tab, i) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={styles.tab}
            aria-current={currentTab === i ? "page" : undefined}
          >
            <Icon name={tab.icon} size={24} />
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

// PlaylistLink is one of my lists in the side menu.
function PlaylistLink({ list }: { list: Playlist }) {
  return (
    <NavLink to={`/playlist/${list.id}`} className={styles.sideLink}>
      <Icon name={list.kind === "later" ? "clock" : "playlist"} size={20} />
      <span className={styles.sideText}>{playlistName(list)}</span>
    </NavLink>
  );
}

// useEnterOnNavigate makes each new page rise softly into place. It moves
// the page with the browser's own animations instead of drawing it again,
// so what the page already loaded stays as it is. Nothing moves for whoever
// asked their device for less motion.
function useEnterOnNavigate(page: RefObject<HTMLDivElement | null>) {
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the animation runs on every new address
  useEffect(() => {
    const element = page.current;
    if (!element?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const move = element.animate(
      [
        { opacity: 0, translate: "0 10px" },
        { opacity: 1, translate: "0 0" },
      ],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => move.cancel();
  }, [pathname, page]);
}

// useMyPlaylists loads my lists for the side menu, again after I create,
// rename or delete one. Without them the menu still has "Tutte le
// playlist", so a failure only goes to the console.
function useMyPlaylists(): Playlist[] {
  const [lists, setLists] = useState<Playlist[]>([]);
  useEffect(() => {
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      fetchPlaylists(undefined, signal)
        .then(setLists)
        .catch((error: unknown) => {
          if (!signal.aborted) console.error(error);
        });
    };
    load();
    const stop = onPlaylistsChanged(load);
    return () => {
      stop();
      controller.abort();
    };
  }, []);
  return lists;
}
