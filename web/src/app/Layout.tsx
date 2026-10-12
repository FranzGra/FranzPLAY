import { type FormEvent, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { Icon } from "../components/Icon";
import styles from "./Layout.module.css";

const sideLinks = [
  { to: "/", label: "Home" },
  { to: "/cronologia", label: "Cronologia" },
  { to: "/categorie", label: "Categorie" },
  { to: "/profilo", label: "Il mio canale" },
];

const tabs = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/playlist", label: "Playlist", icon: "playlist" },
  { to: "/profilo", label: "Profilo", icon: "profile" },
] as const;

// Layout is the frame around every page: top bar, side menu on computers,
// bottom bar with three tabs on phones.
export function Layout() {
  const navigate = useNavigate();
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

        <Link to="/profilo" className={`glass ${styles.avatar}`} aria-label="Il tuo profilo">
          <Icon name="profile" size={20} />
        </Link>
      </header>

      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label="Menu principale">
          {sideLinks.map((link) => (
            <NavLink key={link.to} to={link.to} end className={styles.sideLink}>
              {link.label}
            </NavLink>
          ))}
          <div className={styles.sideHeading}>Le tue playlist</div>
          <NavLink to="/playlist" end className={styles.sideLink}>
            Tutte le playlist
          </NavLink>
        </nav>

        <main className={styles.main}>
          <Outlet />
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
