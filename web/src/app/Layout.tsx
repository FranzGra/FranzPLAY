import { type FormEvent, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { avatarUrl } from "../api/auth";
import { fetchPlaylists, onPlaylistsChanged, type Playlist, playlistName } from "../api/playlists";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { useAccount } from "./auth";
import styles from "./Layout.module.css";

// sideLinks are the first links of the side menu; the channel is mine.
function sideLinks(me: number) {
  return [
    { to: "/", label: "Home", icon: "home" },
    { to: "/cronologia", label: "Cronologia", icon: "history" },
    { to: "/mi-piace", label: "Mi piace", icon: "like" },
    { to: "/categorie", label: "Categorie", icon: "categories" },
    { to: `/canale/${me}`, label: "Il mio canale", icon: "channel" },
  ] as const;
}

const tabs = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/playlist", label: "Playlist", icon: "playlist" },
  { to: "/profilo", label: "Profilo", icon: "profile" },
] as const;

// Layout is the frame around every page: top bar, side menu on computers,
// bottom bar with three tabs on phones.
export function Layout() {
  const navigate = useNavigate();
  const account = useAccount();
  const lists = useMyPlaylists();
  const [query, setQuery] = useState("");

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
          FranzPLAY
        </Link>

        <search className={styles.search}>
          <form onSubmit={onSearch}>
            <label className={`glass ${styles.searchBox}`}>
              <Icon name="search" size={18} />
              <span className="visually-hidden">Cerca</span>
              <input
                type="search"
                placeholder="Cerca tra i tuoi video"
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

      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label="Menu principale">
          {sideLinks(account.id).map((link) => (
            <NavLink key={link.to} to={link.to} end className={styles.sideLink}>
              <Icon name={link.icon} size={20} />
              {link.label}
            </NavLink>
          ))}
          <div className={styles.sideHeading}>Le tue playlist</div>
          <NavLink to="/playlist" end className={styles.sideLink}>
            <Icon name="playlist" size={20} />
            Tutte le playlist
          </NavLink>
          {lists.map((list) => (
            <NavLink key={list.id} to={`/playlist/${list.id}`} className={styles.sideLink}>
              <Icon name={list.kind === "later" ? "clock" : "playlist"} size={20} />
              <span className={styles.sideText}>{playlistName(list)}</span>
            </NavLink>
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
          <div className={styles.page}>
            <Outlet />
          </div>
        </main>
      </div>

      <nav className={`glass ${styles.tabbar}`} aria-label="Menu del telefono">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end className={styles.tab}>
            <Icon name={tab.icon} size={24} />
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
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
