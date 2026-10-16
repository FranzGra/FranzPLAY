import {
  type FormEvent,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router";
import { avatarUrl } from "../api/auth";
import { fetchPlaylists, onPlaylistsChanged, type Playlist, playlistName } from "../api/playlists";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { SiteName } from "../components/SiteName";
import { morphing } from "../features/videos/coverMorph";
import { richMotion } from "../lib/richMotion";
import { restorePlace } from "../lib/scrollMemory";
import { useAccount } from "./auth";
import styles from "./Layout.module.css";
import { preloadLikelyPages } from "./lazyPages";
import { PageLoading } from "./PageLoading";
import { type PageWidth, PageWidthContext } from "./pageWidth";
import { UpdateDialog, UpdatePill, useNewVersion, useUpdateWindow } from "./UpdateNotice";

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
  useScrollPlaces();
  // Once the first page shows, fetch the code of the pages opened most often.
  useEffect(preloadLikelyPages, []);
  const { pathname } = useLocation();
  const currentTab = tabFor(pathname);
  // On a video's page the side menu hides, like on YouTube: the player and
  // the videos beside it get the room. The ☰ button brings it back in its
  // usual place, and the page makes room for it.
  const drawer = pathname.startsWith("/video/");
  const menu = useDrawer(pathname);
  const [width, setWidth] = useState<PageWidth>("normal");
  const newVersion = useNewVersion(account.role === "admin");
  const updateWindow = useUpdateWindow(newVersion);

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
        {/* The bar has three columns as wide on the left as on the right,
            so the search stays in the middle of the screen whatever the
            length of the site's name. */}
        <div className={styles.start}>
          {drawer && (
            <button
              type="button"
              className={styles.menuButton}
              aria-label="Menu"
              aria-expanded={menu.open}
              aria-controls="menu-principale"
              onClick={menu.toggle}
            >
              <Icon name="menu" size={22} />
            </button>
          )}
          <Link to="/" className={styles.logo}>
            <span className={styles.logoMark}>
              <Icon name="play" size={14} />
            </span>
            <span className={styles.logoName}>
              <SiteName accentClass={styles.logoAccent} />
            </span>
          </Link>
        </div>

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

      <div className={styles.body} data-width={width} data-drawer={drawer || undefined}>
        <nav
          id="menu-principale"
          className={styles.sidebar}
          aria-label="Menu principale"
          data-open={(drawer && menu.open) || undefined}
        >
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
          {newVersion && <UpdatePill updates={newVersion} onOpen={updateWindow.show} />}
        </nav>

        <main className={styles.main}>
          <div ref={page} className={styles.page}>
            <PageWidthContext.Provider value={setWidth}>
              <Suspense fallback={<PageLoading />}>
                <Outlet />
              </Suspense>
            </PageWidthContext.Provider>
          </div>
        </main>
      </div>

      {newVersion && updateWindow.open && (
        <UpdateDialog updates={newVersion} onClose={updateWindow.close} />
      )}

      <nav className={`glass ${styles.tabbar}`} aria-label="Menu del telefono">
        {tabs.map((tab, i) => (
          <Link
            key={tab.to}
            to={tab.to}
            className={styles.tab}
            aria-current={currentTab === i ? "page" : undefined}
          >
            <Icon name={tab.icon} size={26} />
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

// useDrawer says whether ☰ has brought the side menu back on a video's
// page. A new page hides it again.
function useDrawer(pathname: string) {
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new address hides the menu
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return { open, toggle };
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
// so what the page already loaded stays as it is. It is the light entrance
// for every browser; when a video card grows into the player (coverMorph)
// that move is the entrance, and this one stays still. Nothing moves for
// whoever asked their device for less motion or less data, or on a weak
// device (richMotion).
function useEnterOnNavigate(page: RefObject<HTMLDivElement | null>) {
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the animation runs on every new address
  useEffect(() => {
    const element = page.current;
    if (!element?.animate || morphing() || !richMotion()) {
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

// useScrollPlaces opens a new page at its top, and brings a page reached
// with the back or forward button to where it was left (scrollMemory).
// Changing only the part after "?" (a filter, a search) keeps the place.
function useScrollPlaces() {
  const { pathname, key } = useLocation();
  const type = useNavigationType();
  const last = useRef(pathname);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every new entry
  useEffect(() => {
    const moved = last.current !== pathname;
    last.current = pathname;
    if (type === "POP") restorePlace();
    else if (moved) window.scrollTo(0, 0);
  }, [pathname, key]);
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
