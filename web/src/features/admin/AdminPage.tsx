import { Suspense, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { useAccount } from "../../app/auth";
import { PageLoading } from "../../app/PageLoading";
import { EmptyState } from "../../components/EmptyState";
import { Icon, type IconName } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import styles from "./Admin.module.css";

type Section = { to: string; label: string; icon: IconName; hint: string };

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
      },
      {
        to: "categorie",
        label: "Categorie",
        icon: "categories",
        hint: "Nomi, colori e immagini delle categorie",
      },
      {
        to: "sottotitoli",
        label: "Sottotitoli",
        icon: "subtitles",
        hint: "Quali video li hanno, crearli e tradurli",
      },
      { to: "commenti", label: "Commenti", icon: "comment", hint: "Leggere e togliere i commenti" },
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

const sections = groups.flatMap((g) => g.sections);

// wideQuery is when the menu of the administration fits beside its pages.
const wideQuery = "(min-width: 1180px)";

// useWide says whether the menu sits beside the pages, and follows the
// window when it changes size. Without matchMedia (tests) it says yes.
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

// AdminPage is the frame of the administration pages: only the
// administrator sees them. On a wide screen the menu stays on the left,
// grouped, beside the open page. On a phone or tablet the menu is a page
// of its own (/admin), and each page has a way back to it.
export function AdminPage() {
  usePageTitle("Amministrazione");
  const account = useAccount();
  const { pathname } = useLocation();
  const wide = useWide();
  if (account.role !== "admin") {
    return (
      <EmptyState title="Solo per l'amministratore" headingLevel={1}>
        Queste pagine servono a chi gestisce FranzPLAY.
      </EmptyState>
    );
  }
  const rest = pathname.replace(/^\/admin\/?/, "");
  const open = sections.find((s) => rest === s.to || rest.startsWith(`${s.to}/`));
  // A page inside a page (one video) has its own way back: the frame
  // leaves it all the room.
  const inner = open !== undefined && rest !== open.to;
  if (!open) {
    if (wide) return <Navigate to="riepilogo" replace />;
    return (
      <>
        <h1 className={styles.heading}>
          <Icon name="shield" size={26} />
          Amministrazione
        </h1>
        <AdminMenu big />
      </>
    );
  }
  return (
    <div className={styles.frame} data-inner={inner || undefined}>
      {wide && !inner && (
        <aside className={`glass ${styles.side}`}>
          <h1 className={styles.sideHeading}>
            <Icon name="shield" size={22} />
            Amministrazione
          </h1>
          <AdminMenu />
        </aside>
      )}
      <div className={styles.content}>
        {!wide && !inner && (
          <>
            <h1 className="visually-hidden">Amministrazione</h1>
            <Link to="/admin" className={styles.backToMenu}>
              <Icon name="chevronLeft" size={18} />
              Amministrazione
            </Link>
          </>
        )}
        {!inner && (
          <h2 className={styles.sectionTitle}>
            <span className={styles.sectionIcon}>
              <Icon name={open.icon} size={20} />
            </span>
            {open.label}
          </h2>
        )}
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

// AdminMenu lists the pages of the administration by group. The big one
// is the menu page on a phone: each page with a line on what it is for.
function AdminMenu({ big = false }: { big?: boolean }) {
  return (
    <nav aria-label="Sezioni dell'amministrazione" className={big ? styles.menuBig : styles.menu}>
      {groups.map((g) => (
        <div key={g.title || "start"} className={styles.menuGroup}>
          {g.title && <p className={styles.menuTitle}>{g.title}</p>}
          <ul className={big ? `glass ${styles.menuList}` : styles.menuList}>
            {g.sections.map((s) => (
              <li key={s.to}>
                <NavLink to={`/admin/${s.to}`} className={styles.menuLink}>
                  <span className={styles.menuIcon}>
                    <Icon name={s.icon} size={big ? 20 : 18} />
                  </span>
                  <span className={styles.menuText}>
                    <span className={styles.menuLabel}>{s.label}</span>
                    {big && <span className={styles.menuHint}>{s.hint}</span>}
                  </span>
                  {big && <Icon name="chevronRight" size={18} />}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
