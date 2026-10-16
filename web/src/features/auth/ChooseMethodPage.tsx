import { useState } from "react";
import { methodNames } from "../../api/auth";
import { useAccount, useAuth } from "../../app/auth";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { CredentialForm } from "../profile/CredentialForm";
import styles from "./AuthPage.module.css";

const oldName = { password: "la password", pin: "il PIN", pattern: "la sequenza" } as const;

// ChooseMethodPage is shown, instead of everything else, to someone whose
// login method the administrator no longer allows: their old one still
// opened the door this time, and now they choose an allowed one.
export function ChooseMethodPage() {
  usePageTitle("Scegli come entrare");
  const account = useAccount();
  const { signedIn, signOut } = useAuth();
  const [failed, setFailed] = useState(false);
  const allowed = account.allowedMethods.map((m) => methodNames[m].toLowerCase()).join(" o ");
  return (
    <main className={styles.root}>
      <div className={`glass ${styles.card} ${styles.wide}`}>
        <span className={styles.logoMark} aria-hidden="true">
          <Icon name="lock" size={22} />
        </span>
        <h1 className={styles.title}>Scegli un nuovo modo di entrare</h1>
        <p className={styles.intro}>
          Ciao {account.name}. Chi gestisce FranzPLAY non ammette più {oldName[account.loginMethod]}{" "}
          per il tuo account: per continuare scegli {allowed}.
        </p>
        <CredentialForm account={account} onDone={signedIn} />
        <p className={styles.switch}>
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              setFailed(false);
              signOut().catch((error: unknown) => {
                console.error(error);
                setFailed(true);
              });
            }}
          >
            Esci
          </button>
        </p>
        {failed && (
          <p className={styles.error} role="alert">
            Uscita non riuscita: il server non risponde. Riprova.
          </p>
        )}
      </div>
    </main>
  );
}
