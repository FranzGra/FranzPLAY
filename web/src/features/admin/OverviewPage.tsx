import { type CSSProperties, useState } from "react";
import { Link } from "react-router";
import { retryFailedJobs } from "../../api/jobs";
import { scanLibrary } from "../../api/library";
import type { Disk, Problem } from "../../api/overview";
import { useAccount } from "../../app/auth";
import { Icon } from "../../components/Icon";
import { formatBytes } from "../../lib/format";
import { runningJobs, useActivity } from "./activity";
import { DownloadBox, NowJob } from "./NowJob";
import screens from "./Screens.module.css";
import { Card, Empty, Loading, Notice, n, PageHeader, Unavailable, ui, useToast } from "./ui";

// greeting says hello as the hour asks.
function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5 || h >= 18) return "Buonasera";
  if (h < 13) return "Buongiorno";
  return "Buon pomeriggio";
}

// OverviewPage is the console's first page: the big numbers, what
// FranzPLAY is doing now, what needs a hand and how full the disks are.
export function OverviewPage() {
  const account = useAccount();
  const { overview: o, overviewFailed, jobs, download, working, refresh } = useActivity();
  const [toast, say] = useToast();
  const [scanning, setScanning] = useState(false);

  if (!o) return overviewFailed ? <Unavailable title="Riepilogo non disponibile" /> : <Loading />;

  const v = o.videos;
  const waiting = jobs?.waiting ?? o.jobs.waiting;
  const running = runningJobs(jobs);
  const problems = o.problems.length;
  const first = account.name.split(" ")[0];

  const summary = [
    problems === 0
      ? "Non c'è niente da sistemare"
      : problems === 1
        ? "C'è una cosa da guardare"
        : `Ci sono ${n(problems)} cose da guardare`,
    working === 0
      ? "nessun lavoro in corso"
      : working === 1
        ? "un lavoro in corso"
        : `${n(working)} lavori in corso`,
  ].join(" e ");

  const scan = () => {
    setScanning(true);
    scanLibrary()
      .then(() => say("Controllo le cartelle: i video nuovi arrivano tra poco."))
      .catch(() => say("Il controllo non è partito. Riprova tra poco.", true))
      .finally(() => setScanning(false));
  };

  return (
    <>
      <PageHeader
        title={`${greeting(new Date())}, ${first}`}
        description={`${summary}.`}
        actions={
          <>
            <button type="button" className={ui.btn} disabled={scanning} onClick={scan}>
              <Icon name="refresh" size={18} />
              Controlla le cartelle
            </button>
            <Link to="/admin/inviti" className={`${ui.btn} ${ui.primary}`}>
              <Icon name="mail" size={18} />
              Invita una persona
            </Link>
          </>
        }
      />

      <section className={screens.kpis} aria-label="In numeri">
        <Link to="/admin/video" className={screens.kpi}>
          <span className={screens.kpiLabel}>
            Video <Icon name="chevronRight" size={16} />
          </span>
          <span className={screens.kpiValue}>{n(v.present)}</span>
          <span className={screens.kpiNote}>
            {v.analysed > 0 && (
              <>
                <b>{Math.round((100 * v.playable) / v.analysed)}%</b> pronti per tutti i browser
              </>
            )}
            {v.hidden > 0 && ` · ${n(v.hidden)} nascosti`}
          </span>
        </Link>
        <Link to="/admin/persone" className={screens.kpi}>
          <span className={screens.kpiLabel}>
            Persone <Icon name="chevronRight" size={16} />
          </span>
          <span className={screens.kpiValue}>{n(o.people)}</span>
          <span className={screens.kpiNote}>
            {o.admins === 1 ? "1 amministratore" : `${n(o.admins)} amministratori`}
          </span>
        </Link>
        <Link to="/admin/commenti" className={screens.kpi}>
          <span className={screens.kpiLabel}>
            Commenti <Icon name="chevronRight" size={16} />
          </span>
          <span className={screens.kpiValue}>{n(o.comments)}</span>
          <span className={screens.kpiNote}>
            {o.categories === 1 ? "1 categoria" : `${n(o.categories)} categorie`}
          </span>
        </Link>
        <Link to="/admin/lavori" className={screens.kpi}>
          <span className={screens.kpiLabel}>
            Lavori <Icon name="chevronRight" size={16} />
          </span>
          <span className={screens.kpiValue}>{n(working + waiting)}</span>
          <span className={screens.kpiNote}>
            <b>{n(working)}</b> in corso · {n(waiting)} in coda
          </span>
        </Link>
      </section>

      <div className={ui.grid}>
        <div className={`${ui.stack} ${ui.span8}`}>
          <Card
            title="Al lavoro ora"
            icon="layers"
            tone={working > 0 ? "busy" : undefined}
            actions={
              <Link to="/admin/lavori" className={`${ui.btn} ${ui.small}`}>
                Tutti i lavori{waiting > 0 && ` · ${n(waiting)} in coda`}
              </Link>
            }
          >
            {running.length > 0 ? (
              <div className={screens.nowList}>
                {running.map((job, i) => (
                  <NowJob key={job.id} job={job} waiting={i === running.length - 1 ? waiting : 0} />
                ))}
              </div>
            ) : download ? null : (
              <p className={screens.quiet}>
                <Icon name="check" size={22} />
                <span>
                  <b>FranzPLAY è fermo</b>
                  {waiting > 0
                    ? `${n(waiting)} lavori aspettano il loro turno.`
                    : "Tutti i video sono pronti: non c'è niente da preparare."}
                </span>
              </p>
            )}
            {download && <DownloadBox download={download} />}
          </Card>

          <Card title="Spazio sui dischi" icon="disk">
            {o.disks.length === 0 ? (
              <p className={ui.cardText}>Nessun disco da mostrare.</p>
            ) : (
              o.disks.map((d) => <DiskRow key={d.folder} disk={d} />)
            )}
          </Card>
        </div>

        <div className={`${ui.stack} ${ui.span4}`}>
          <Card
            title="Da sistemare"
            icon="alert"
            sub={
              problems > 0 ? (
                <span className={ui.chip} data-tone="warn">
                  {problems}
                </span>
              ) : null
            }
          >
            {problems === 0 ? (
              <Empty icon="check" title="Tutto a posto" headingLevel={3}>
                Non c'è niente da sistemare.
              </Empty>
            ) : (
              o.problems.map((p) => (
                <ProblemNotice
                  key={`${p.kind}-${p.folder}`}
                  problem={p}
                  onRetried={(count) => {
                    say(
                      count === 1
                        ? "1 lavoro rimesso in coda."
                        : `${n(count)} lavori rimessi in coda.`,
                    );
                    refresh();
                  }}
                  onFailed={() => say("Non è stato possibile. Riprova tra poco.", true)}
                />
              ))
            )}
          </Card>

          <Card title="Il sito" icon="info">
            <dl className={ui.kv}>
              <dt>Versione</dt>
              <dd className={ui.mono}>{o.version}</dd>
              <dt>Video letti</dt>
              <dd>
                {n(v.analysed)} di {n(v.present)}
              </dd>
              <dt>Senza copertina</dt>
              <dd>{n(v.noCover)}</dd>
              <dt>Non trovati</dt>
              <dd>{n(v.missing)}</dd>
              <dt>Categorie</dt>
              <dd>{n(o.categories)}</dd>
            </dl>
          </Card>
        </div>
      </div>
      {toast}
    </>
  );
}

// DiskRow is one disk: what it holds, how much is free in big, and a
// thick bar of what is used.
function DiskRow({ disk }: { disk: Disk }) {
  const what = disk.data ? "Cartella dati di FranzPLAY" : "Cartella dei video";
  if (disk.error) {
    return (
      <div className={screens.disk}>
        <div className={screens.diskHead}>
          <p className={screens.diskName}>
            {what}
            <code>{disk.folder}</code>
          </p>
          <span className={ui.chip} data-tone="bad">
            Non si legge
          </span>
        </div>
        <p className={ui.cardText}>Forse il disco non è collegato.</p>
      </div>
    );
  }
  const used = disk.total - disk.free;
  const percent = disk.total > 0 ? Math.round((100 * used) / disk.total) : 0;
  const tone = percent >= 95 ? "danger" : percent >= 85 ? "warning" : undefined;
  return (
    <div className={screens.disk}>
      <div className={screens.diskHead}>
        <p className={screens.diskName}>
          {what}
          <code>{disk.folder}</code>
        </p>
        <p className={screens.diskFree}>
          <b>{formatBytes(disk.free)}</b> liberi su {formatBytes(disk.total)} · {percent}% usato
        </p>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a meter element cannot hold the colored parts */}
      <div
        className={screens.diskBar}
        role="meter"
        aria-label={`${what}: ${percent}% usato`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className={screens.diskUsed} data-tone={tone} style={{ width: `${percent}%` }} />
      </div>
      <ul className={screens.legend}>
        <li
          style={
            {
              "--swatch":
                tone === "danger"
                  ? "#ef4444"
                  : tone === "warning"
                    ? "#f59e0b"
                    : "var(--color-accent)",
            } as CSSProperties
          }
        >
          Usato {formatBytes(used)}
        </li>
        <li>Libero {formatBytes(disk.free)}</li>
      </ul>
    </div>
  );
}

// ProblemNotice says a problem in words, with the button that fixes it or
// the page where it is fixed.
function ProblemNotice({
  problem: p,
  onRetried,
  onFailed,
}: {
  problem: Problem;
  onRetried: (count: number) => void;
  onFailed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const tone = p.severity === "critical" ? "bad" : undefined;
  const go = (to: string, label: string) => (
    <Link to={to} className={`${ui.btn} ${ui.small}`}>
      {label}
    </Link>
  );
  switch (p.kind) {
    case "no_ffmpeg":
      return (
        <Notice
          tone="bad"
          title="Mancano ffmpeg o ffprobe"
          actions={go("/admin/lavori", "Vedi i lavori")}
        >
          Senza, i video restano senza durata, copertina e anteprime. Installali e riavvia
          FranzPLAY.
        </Notice>
      );
    case "disk_full":
      return (
        <Notice tone="bad" icon="disk" title={`Il disco di ${p.folder} è quasi pieno`}>
          Libera un po' di spazio, o i video nuovi non avranno copertine e anteprime.
        </Notice>
      );
    case "disk_low":
      return (
        <Notice tone={tone} icon="disk" title={`Il disco di ${p.folder} si sta riempiendo`}>
          C'è ancora posto, ma conviene liberare un po' di spazio presto.
        </Notice>
      );
    case "disk_unread":
      return (
        <Notice
          tone="bad"
          icon="folder"
          title={`Non si legge ${p.folder}`}
          actions={go("/admin/cartelle", "Vedi le cartelle")}
        >
          Forse il disco non è collegato.
        </Notice>
      );
    case "failed_jobs":
      return (
        <Notice
          tone={tone}
          icon="layers"
          title={
            p.count === 1 ? "1 lavoro non è riuscito" : `${n(p.count)} lavori non sono riusciti`
          }
          actions={
            <>
              <button
                type="button"
                className={`${ui.btn} ${ui.small} ${ui.primary}`}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  retryFailedJobs()
                    .then(onRetried)
                    .catch(onFailed)
                    .finally(() => setBusy(false));
                }}
              >
                <Icon name="refresh" size={16} />
                Riprova tutti
              </button>
              {go("/admin/lavori", "Vedi perché")}
            </>
          }
        />
      );
    case "missing_videos":
      return (
        <Notice
          tone={tone}
          icon="film"
          title={
            p.count === 1 ? "1 video non si trova più" : `${n(p.count)} video non si trovano più`
          }
          actions={go("/admin/video?show=missing", "Vedi quali")}
        >
          Se li hai solo spostati, FranzPLAY li ritrova da solo al prossimo controllo.
        </Notice>
      );
    case "no_covers":
      return (
        <Notice
          tone={tone}
          icon="image"
          title={p.count === 1 ? "1 video senza copertina" : `${n(p.count)} video senza copertina`}
          actions={go("/admin/lavori", "Vedi i lavori")}
        >
          FranzPLAY le prepara da solo: se il numero non scende, guarda i lavori non riusciti.
        </Notice>
      );
  }
}
