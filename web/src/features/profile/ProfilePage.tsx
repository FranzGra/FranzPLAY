import { useState } from "react";
import { Link } from "react-router";
import { useAccount, useAuth } from "../../app/auth";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { AccentPicker } from "./AccentPicker";
import { DeleteAccount } from "./DeleteAccount";
import { NameForm } from "./NameForm";
import { PasswordForm } from "./PasswordForm";
import styles from "./ProfilePage.module.css";
import { ProfilePhoto } from "./ProfilePhoto";
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
  const { signedIn, signOut } = useAuth();
  const [signOutFailed, setSignOutFailed] = useState(false);
  // At most one form is open, and the last change made is told below it.
  const [editing, setEditing] = useState<"name" | "password" | null>(null);
  const [done, setDone] = useState("");

  function onSignOut() {
    setSignOutFailed(false);
    signOut().catch((error: unknown) => {
      console.error(error);
      setSignOutFailed(true);
    });
  }

  return (
    <div className={styles.root}>
      <ProfilePhoto>
        <h1 className={styles.name}>{account.name}</h1>
        <p className={styles.role}>{account.role === "admin" ? "Amministratore" : "Utente"}</p>
      </ProfilePhoto>

      {account.canUpload ? (
        <Link to="/carica" className={styles.upload}>
          <Icon name="upload" size={20} />
          Carica un video
        </Link>
      ) : (
        <>
          <button type="button" className={styles.upload} disabled aria-describedby="upload-hint">
            <Icon name="upload" size={20} />
            Carica un video
          </button>
          <p id="upload-hint" className={styles.hint}>
            Per caricare video serve il permesso dell'amministratore.
          </p>
        </>
      )}

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

      <AccentPicker />

      <section className={`glass ${styles.rows}`} aria-label="Il tuo account">
        {editing === null && (
          <>
            <button
              type="button"
              className={styles.row}
              onClick={() => {
                setDone("");
                setEditing("name");
              }}
            >
              Cambia nome
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </button>
            <button
              type="button"
              className={styles.row}
              onClick={() => {
                setDone("");
                setEditing("password");
              }}
            >
              Cambia password
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </button>
          </>
        )}
        <button type="button" className={styles.row} onClick={onSignOut}>
          Esci
        </button>
      </section>
      {signOutFailed && (
        <p className={styles.signOutError} role="alert">
          Uscita non riuscita: il server non risponde. Riprova.
        </p>
      )}

      {editing === "name" && (
        <NameForm
          current={account.name}
          onDone={(renamed) => {
            signedIn(renamed);
            setEditing(null);
            setDone("Nome cambiato. Da ora entri con il nome nuovo.");
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {editing === "password" && (
        <PasswordForm
          onDone={() => {
            setEditing(null);
            setDone("Password cambiata. Sugli altri dispositivi dovrai entrare di nuovo.");
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {done && (
        <p className={styles.hint} role="status">
          {done}
        </p>
      )}

      <DeleteAccount />

      <p className={styles.version} role="status">
        {versionText(server)}
      </p>
    </div>
  );
}
