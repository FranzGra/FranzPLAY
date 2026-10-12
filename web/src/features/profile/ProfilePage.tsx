import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import styles from "./ProfilePage.module.css";
import { type ServerInfoState, useServerInfo } from "./useServerInfo";

const rows = [
  { to: "/cronologia", label: "Cronologia" },
  { to: "/categorie", label: "Categorie" },
  { to: "/playlist", label: "Le mie playlist" },
];

function versionText(state: ServerInfoState): string {
  switch (state.kind) {
    case "loading":
      return "Controllo il server…";
    case "ready":
      return `FranzPLAY versione ${state.info.version}`;
    case "error":
      return "Il server non risponde.";
  }
}

export function ProfilePage() {
  usePageTitle("Profilo");
  const server = useServerInfo();

  return (
    <div className={styles.root}>
      <div className={styles.identity}>
        <span className={`glass ${styles.avatar}`}>
          <Icon name="profile" size={28} />
        </span>
        <h1 className={styles.name}>Il tuo profilo</h1>
      </div>

      <button type="button" className={styles.upload} disabled aria-describedby="upload-hint">
        <Icon name="upload" size={20} />
        Carica un video
      </button>
      <p id="upload-hint" className={styles.hint}>
        Il caricamento dei video arriverà in una prossima versione.
      </p>

      <nav className={`glass ${styles.rows}`} aria-label="Le tue pagine">
        {rows.map((row) => (
          <Link key={row.to} to={row.to} className={styles.row}>
            {row.label}
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </nav>

      <p className={styles.version} role="status">
        {versionText(server)}
      </p>
    </div>
  );
}
