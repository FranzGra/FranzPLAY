import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import { type Disk, fetchOverview, type Overview, type Problem } from "../../api/overview";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatBytes } from "../../lib/format";
import styles from "./Admin.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; overview: Overview };

const n = (x: number) => x.toLocaleString("it-IT");

// OverviewPage is the administrator's summary: what needs attention, the
// numbers of the site and how much space is left on the disks.
export function OverviewPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchOverview(controller.signal)
      .then((overview) => setState({ kind: "ready", overview }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Riepilogo non disponibile">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  const o = state.overview;
  const v = o.videos;
  return (
    <>
      <h2 className={styles.groupTitle}>Da sistemare</h2>
      {o.problems.length === 0 ? (
        <p className={`glass ${styles.person} ${styles.problemRow} ${styles.plain}`}>
          <span className={`${styles.problemMark} ${styles.allGood}`} aria-hidden="true">
            <Icon name="check" size={16} />
          </span>
          Tutto a posto: non c'è niente da sistemare.
        </p>
      ) : (
        <ul className={`stagger ${styles.list}`} aria-label="Da sistemare">
          {o.problems.map((p) => (
            <li
              key={`${p.kind}-${p.folder}`}
              className={`glass ${styles.person} ${styles.problemRow} ${p.severity === "critical" ? styles.critical : ""}`}
            >
              <span className={styles.problemMark} aria-hidden="true">
                !
              </span>
              <ProblemText problem={p} />
            </li>
          ))}
        </ul>
      )}

      <h2 className={styles.groupTitle}>In numeri</h2>
      <dl className={styles.stats}>
        <Stat label="Video" to="/admin/video">
          <span className={styles.number}>{n(v.present)}</span>
          {v.analysed > 0 && (
            <span className={styles.note}>
              {Math.round((100 * v.playable) / v.analysed)}% pronti per tutti i dispositivi
            </span>
          )}
          {v.hidden > 0 && <span className={styles.note}>{n(v.hidden)} nascosti</span>}
        </Stat>
        <Stat label="Categorie" to="/categorie">
          <span className={styles.number}>{n(o.categories)}</span>
        </Stat>
        <Stat label="Persone" to="/admin/persone">
          <span className={styles.number}>{n(o.people)}</span>
          <span className={styles.note}>
            {o.admins === 1 ? "1 amministratore" : `${n(o.admins)} amministratori`}
          </span>
        </Stat>
        <Stat label="Commenti" to="/admin/commenti">
          <span className={styles.number}>{n(o.comments)}</span>
        </Stat>
        <Stat label="Lavori in attesa" to="/admin/lavori">
          <span className={styles.number}>{n(o.jobs.waiting)}</span>
        </Stat>
      </dl>

      <h2 className={styles.groupTitle}>Spazio sui dischi</h2>
      <ul className={`stagger ${styles.list}`} aria-label="Dischi">
        {o.disks.map((d) => (
          <li key={d.folder} className={`glass ${styles.person}`}>
            <DiskRow disk={d} />
          </li>
        ))}
      </ul>
      <p className={styles.version}>FranzPLAY versione {o.version}</p>
    </>
  );
}

function Stat({ label, to, children }: { label: string; to: string; children: ReactNode }) {
  return (
    <div className={`glass ${styles.stat}`}>
      <dt>
        <Link to={to} className={styles.statLink}>
          {label}
          <Icon name="chevronRight" size={14} />
        </Link>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function DiskRow({ disk }: { disk: Disk }) {
  const what = disk.data ? "Cartella dati di FranzPLAY" : "Cartella dei video";
  if (disk.error) {
    return (
      <div>
        <p className={styles.name}>{what}</p>
        <p className={styles.role}>
          <code>{disk.folder}</code> · non si riesce a leggere
        </p>
      </div>
    );
  }
  const used = disk.total - disk.free;
  const percent = disk.total > 0 ? Math.round((100 * used) / disk.total) : 0;
  return (
    <div className={styles.disk}>
      <p className={styles.name}>{what}</p>
      <p className={styles.role}>
        <code>{disk.folder}</code> · liberi {formatBytes(disk.free)} su {formatBytes(disk.total)}
      </p>
      <meter
        className={styles.meter}
        min={0}
        max={100}
        low={75}
        high={90}
        optimum={0}
        value={percent}
        aria-label={`${what}: ${percent}% usato`}
      />
    </div>
  );
}

// ProblemText says a problem in words, with a link to where it is fixed.
function ProblemText({ problem: p }: { problem: Problem }) {
  switch (p.kind) {
    case "no_ffmpeg":
      return (
        <p className={styles.plain}>
          FranzPLAY non trova ffmpeg o ffprobe: i video restano senza durata, copertina e anteprime.
          Installali e riavvia FranzPLAY. <Link to="/admin/lavori">Vedi i lavori</Link>
        </p>
      );
    case "disk_full":
      return (
        <p className={styles.plain}>
          Il disco di <code>{p.folder}</code> è quasi pieno: libera un po' di spazio.
        </p>
      );
    case "disk_low":
      return (
        <p className={styles.plain}>
          Il disco di <code>{p.folder}</code> si sta riempiendo.
        </p>
      );
    case "disk_unread":
      return (
        <p className={styles.plain}>
          Non si riesce a leggere <code>{p.folder}</code>: forse il disco non è collegato.{" "}
          <Link to="/admin/cartelle">Vedi le cartelle</Link>
        </p>
      );
    case "failed_jobs":
      return (
        <p className={styles.plain}>
          {p.count === 1 ? "1 lavoro non è riuscito." : `${n(p.count)} lavori non sono riusciti.`}{" "}
          <Link to="/admin/lavori">Vedi i lavori</Link>
        </p>
      );
    case "missing_videos":
      return (
        <p className={styles.plain}>
          {p.count === 1
            ? "1 video non si trova più nelle cartelle."
            : `${n(p.count)} video non si trovano più nelle cartelle.`}{" "}
          Se li hai solo spostati, FranzPLAY li ritrova da solo.{" "}
          <Link to="/admin/cartelle">Vedi le cartelle</Link>
        </p>
      );
    case "no_covers":
      return (
        <p className={styles.plain}>
          {p.count === 1
            ? "1 video è ancora senza copertina."
            : `${n(p.count)} video sono ancora senza copertina.`}{" "}
          <Link to="/admin/lavori">Vedi i lavori</Link>
        </p>
      );
  }
}
