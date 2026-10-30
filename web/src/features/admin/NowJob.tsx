import { Link } from "react-router";
import type { ModelDownload } from "../../api/autosubs";
import type { Job } from "../../api/jobs";
import { Icon } from "../../components/Icon";
import { ProgressBar } from "../../components/ProgressBar";
import { formatBytes, formatDuration, formatRemaining, formatSince } from "../../lib/format";
import { downloadLeft, downloadPercent } from "./activity";
import {
  kindNames,
  progressText,
  stageNames,
  useJobVideo,
  workNumbers,
  workPercent,
} from "./jobText";
import screens from "./Screens.module.css";
import { Chip, n, ui } from "./ui";

// NowJob is a job FranzPLAY is doing now, told big: the video's picture,
// what is being done to it, since when, and a bar that fills as it goes
// (or only moves, when the job cannot tell how far it is).
export function NowJob({ job, waiting }: { job: Job; waiting: number }) {
  const video = useJobVideo(job.cover ? null : job.videoId);
  const cover = job.cover ?? video?.cover ?? null;
  const duration = job.duration ?? video?.duration ?? null;
  const percent = workPercent(job);
  const how = progressText(job);
  const heard = workNumbers(job);
  return (
    <div className={screens.nowJob}>
      <Link
        to={`/admin/video/${job.videoId}`}
        className={ui.thumb}
        data-working
        aria-label={`Apri ${job.title}`}
      >
        {cover ? <img src={cover} alt="" /> : <Icon name="film" size={28} />}
        {duration ? <span className={ui.duration}>{formatDuration(duration)}</span> : null}
      </Link>
      <div className={screens.nowBody}>
        <div className={ui.chips}>
          <Chip tone="live">{kindNames[job.kind]}</Chip>
          {job.stage && stageNames[job.stage] && <Chip tone="info">{stageNames[job.stage]}</Chip>}
          {job.attempts > 1 && <Chip tone="warn">Tentativo {job.attempts}</Chip>}
        </div>
        <h3 className={screens.nowTitle}>
          <Link to={`/admin/video/${job.videoId}`}>{job.title}</Link>
        </h3>
        <ProgressBar
          size="big"
          percent={percent}
          label={`${kindNames[job.kind]} di ${job.title}`}
        />
        {(how || heard) && (
          <p className={screens.nowNumbers}>
            {how && <b>{how}</b>}
            {heard && <span>{heard}</span>}
          </p>
        )}
        <p className={screens.nowMeta}>
          Iniziato {formatSince(job.startedAt ?? job.at, new Date())}
          {waiting > 0 && ` · poi ${n(waiting)} in coda`}
        </p>
      </div>
    </div>
  );
}

// DownloadBox is a whisper model being downloaded, beside the queue.
export function DownloadBox({ download }: { download: ModelDownload }) {
  const percent = downloadPercent(download);
  return (
    <div className={screens.downloadBox}>
      <p className={screens.downloadTitle}>
        <b>Scarico il modello {download.name}</b>
        <span> · per i sottotitoli automatici, in parallelo ai lavori</span>
      </p>
      <p className={screens.downloadNumbers}>{downloadNumbers(download, percent)}</p>
      <ProgressBar percent={percent} label={`Scarico il modello ${download.name}`} />
    </div>
  );
}

// downloadNumbers says how a download goes: "120 MB di 142 MB · 84% ·
// 6,2 MB/s · restano meno di un minuto".
export function downloadNumbers(d: ModelDownload, percent = downloadPercent(d)) {
  const left = downloadLeft(d);
  return (
    <>
      <b>{formatBytes(d.done)}</b>
      {d.total > 0 && ` di ${formatBytes(d.total)}`}
      {percent !== null && ` · ${Math.floor(percent)}%`}
      {d.speed > 0 && ` · ${formatBytes(d.speed)}/s`}
      {left !== null && ` · restano ${formatRemaining(left)}`}
    </>
  );
}
