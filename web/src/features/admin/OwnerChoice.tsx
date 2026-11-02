import { useEffect, useId, useState } from "react";
import { type AdminVideo, setVideoAudience } from "../../api/adminVideos";
import { fetchPeople, type SharePerson } from "../../api/people";
import { useAccount } from "../../app/auth";
import { Select } from "../../components/Select";
import edit from "./Edit.module.css";
import { ui } from "./ui";

// OwnerChoice is for a private video with no owner: who uploaded it did not
// come back with it (a database lost, an account gone), so nobody sees it. The
// administrator gives it an owner, or opens it to everybody. onDone gets the
// message to show, after the change.
export function OwnerChoice({
  video,
  onDone,
  onFailed,
}: {
  video: AdminVideo;
  onDone: (message: string) => void;
  onFailed: () => void;
}) {
  const me = useAccount();
  const [people, setPeople] = useState<SharePerson[]>([]);
  const [owner, setOwner] = useState(0);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const labelId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetchPeople(controller.signal)
      .then((list) => setPeople(list))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);

  // The list of people leaves out who asks: the administrator may be the owner too.
  const choices = [
    { value: 0, label: "Scegli una persona…", name: "" },
    { value: me.id, label: `${me.name} (tu)`, name: me.name },
    ...people.map((p) => ({ value: p.id, label: p.name, name: p.name })),
  ];

  async function choose(change: { owner: number } | { everyone: true }, message: string) {
    setBusy(true);
    try {
      await setVideoAudience(video.id, change);
      onDone(message);
    } catch (error) {
      console.error(error);
      onFailed();
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <div className={edit.ownerChoice}>
      <p className={ui.hint}>
        Nessuno lo vede: è privato e chi l'ha caricato non c'è più su FranzPLAY. Scegli a chi darlo,
        oppure aprilo a tutti.
      </p>
      <div className={ui.field}>
        <span id={labelId} className={ui.label}>
          Nuovo proprietario
        </span>
        <Select
          labelledBy={labelId}
          value={owner}
          options={choices}
          disabled={busy}
          onChange={setOwner}
        />
      </div>
      {asking ? (
        <div className={edit.confirm} role="alert">
          <p>Lo vedranno tutti quelli che hanno un account. Lo apro?</p>
          <button
            type="button"
            className={`${ui.btn} ${ui.small} ${ui.primary}`}
            disabled={busy}
            onClick={() => void choose({ everyone: true }, "Ora lo vedono tutti con un account.")}
          >
            {busy ? "Apro…" : "Sì, aprilo"}
          </button>
          <button
            type="button"
            className={`${ui.btn} ${ui.small}`}
            disabled={busy}
            onClick={() => setAsking(false)}
          >
            Annulla
          </button>
        </div>
      ) : (
        <div className={edit.ownerActions}>
          <button
            type="button"
            className={`${ui.btn} ${ui.primary}`}
            disabled={busy || owner === 0}
            onClick={() => {
              const chosen = choices.find((p) => p.value === owner);
              void choose({ owner }, `Ora è di ${chosen?.name ?? "chi hai scelto"}.`);
            }}
          >
            {busy ? "Salvo…" : "Dagli questo proprietario"}
          </button>
          <button type="button" className={ui.btn} disabled={busy} onClick={() => setAsking(true)}>
            Aprilo a tutti
          </button>
        </div>
      )}
    </div>
  );
}
