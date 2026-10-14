import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useAccount } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import styles from "./Admin.module.css";

// sections are the pages of the administration, in the order shown.
const sections = [
  { to: "riepilogo", label: "Riepilogo" },
  { to: "persone", label: "Persone" },
  { to: "inviti", label: "Inviti" },
  { to: "accessi", label: "Accessi" },
  { to: "video", label: "Video" },
  { to: "categorie", label: "Categorie" },
  { to: "sottotitoli", label: "Sottotitoli" },
  { to: "commenti", label: "Commenti" },
  { to: "cartelle", label: "Cartelle" },
  { to: "internet", label: "Internet" },
  { to: "lavori", label: "Lavori" },
  { to: "sito", label: "Sito" },
] as const;

// AdminPage is the frame of the administration pages: only the
// administrator sees them.
export function AdminPage() {
  usePageTitle("Amministrazione");
  const account = useAccount();
  const tabs = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // On a narrow screen the row of tabs slides sideways: bring the open
  // page's tab to the middle, so the person always sees where they are.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is the reason to scroll
  useEffect(() => {
    const row = tabs.current;
    const open = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !open || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = open.offsetLeft - (row.clientWidth - open.offsetWidth) / 2;
  }, [pathname]);
  if (account.role !== "admin") {
    return (
      <EmptyState title="Solo per l'amministratore" headingLevel={1}>
        Queste pagine servono a chi gestisce FranzPLAY.
      </EmptyState>
    );
  }
  return (
    <>
      <h1 className={styles.heading}>
        <Icon name="shield" size={26} />
        Amministrazione
      </h1>
      <nav ref={tabs} className={`glass ${styles.tabs}`} aria-label="Sezioni dell'amministrazione">
        {sections.map((s) => (
          <NavLink key={s.to} to={s.to} className={styles.tab}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
