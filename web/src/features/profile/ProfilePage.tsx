import { useState } from "react";
import { Link } from "react-router";
import { useAccount, useAuth } from "../../app/auth";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { PasswordForm } from "./PasswordForm";
import styles from "./ProfilePage.module.css";
import { type ServerInfoState, useServerInfo } from "./useServerInfo";

const rows = (me: number) => [
  { to: `/canale/${me}`, label: "Il mio canale" },
  { to: "/cronologia", label: "Cronologia" },
];
const adminRows = [{ to: "/admin", label: "Amministrazione" }];

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
  const account = useAccount();
  const { signOut } = useAuth();
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);

  function onSignOut() {
    setSignOutFailed(false);
    signOut().catch((error: unknown) => {
      console.error(error);
      setSignOutFailed(true);
    });
  }

  return (
    <div className={styles.root}>
      <div className={styles.identity}>
        <Avatar name={account.name} size={64} />
        <div>
          <h1 className={styles.name}>{account.name}</h1>
          <p className={styles.role}>{account.role === "admin" ? "Amministratore" : "Utente"}</p>
        </div>
      </div>

      <button type="button" className={styles.upload} disabled aria-describedby="upload-hint">
        <Icon name="upload" size={20} />
        Carica un video
      </button>
      <p id="upload-hint" className={styles.hint}>
        Il caricamento dei video arriverà in una prossima versione.
      </p>

      <nav className={`glass ${styles.rows}`} aria-label="Le tue pagine">
        {[...rows(account.id), ...(account.role === "admin" ? adminRows : [])].map((row) => (
          <Link key={row.to} to={row.to} className={styles.row}>
            {row.label}
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </nav>

      {changing ? (
        <PasswordForm
          onDone={() => {
            setChanging(false);
            setChanged(true);
          }}
          onCancel={() => setChanging(false)}
        />
      ) : (
        <button
          type="button"
          className={`glass ${styles.signOut}`}
          onClick={() => {
            setChanged(false);
            setChanging(true);
          }}
        >
          Cambia password
        </button>
      )}
      {changed && (
        <p className={styles.hint} role="status">
          Password cambiata. Sugli altri dispositivi dovrai entrare di nuovo.
        </p>
      )}

      <button type="button" className={`glass ${styles.signOut}`} onClick={onSignOut}>
        Esci
      </button>
      {signOutFailed && (
        <p className={styles.signOutError} role="alert">
          Uscita non riuscita: il server non risponde. Riprova.
        </p>
      )}

      <p className={styles.version} role="status">
        {versionText(server)}
      </p>
    </div>
  );
}
