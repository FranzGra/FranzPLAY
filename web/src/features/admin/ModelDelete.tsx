import { useEffect, useId, useRef, useState } from "react";
import type { ModelFile } from "../../api/autosubs";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { formatBytes } from "../../lib/format";
import pages from "./Pages.module.css";
import { ui } from "./ui";

// usedSpace says what the models here take, after their names: " · 2 GB in
// tutto". Nothing when the server does not say.
export function usedSpace(files: ModelFile[]): string {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  return total > 0 ? ` · ${formatBytes(total)} in tutto` : "";
}

// DeleteModelButton is the Elimina of a model. While some work needs the model
// it stays off, and the row says why.
export function DeleteModelButton({
  title,
  busy,
  asking,
  onAsk,
}: {
  title: string;
  busy: boolean;
  asking: boolean;
  onAsk: () => void;
}) {
  return (
    <button
      type="button"
      className={`${ui.btn} ${ui.small} ${ui.ghost}`}
      disabled={busy || asking}
      aria-label={`Elimina ${title}`}
      onClick={onAsk}
    >
      <Icon name="trash" size={16} />
      Elimina
    </button>
  );
}

// ConfirmModelDelete asks before deleting: it says how much space comes back
// and what happens then. A refusal of the server comes in words, and shows here.
export function ConfirmModelDelete({
  file,
  title,
  effect,
  remove,
  onCancel,
  onDone,
}: {
  file: ModelFile;
  title: string;
  effect: string;
  remove: () => Promise<void>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const words = useId();
  const stay = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);

  useEffect(() => {
    before.current = document.activeElement;
    stay.current?.focus();
  }, []);

  const cancel = () => {
    onCancel();
    if (before.current instanceof HTMLElement) before.current.focus();
  };

  const confirm = () => {
    setBusy(true);
    setProblem("");
    remove()
      .then(onDone)
      .catch((error: unknown) => {
        setBusy(false);
        // 404: it was gone already, which is what was asked.
        if (error instanceof ApiError && error.status === 404) return onDone();
        console.error(error);
        setProblem(
          error instanceof ApiError && error.status === 409
            ? error.message
            : "Non sono riuscito a eliminarlo. Riprova tra poco.",
        );
      });
  };

  return (
    <div
      className={pages.confirm}
      role="alertdialog"
      aria-label={`Eliminare ${title}?`}
      aria-describedby={words}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) cancel();
      }}
    >
      <p id={words}>
        Eliminare <strong>{title}</strong>? Libera {formatBytes(file.size)} sul disco. {effect}
      </p>
      <div className={ui.chips}>
        <button
          ref={stay}
          type="button"
          className={`${ui.btn} ${ui.small} ${ui.ghost}`}
          disabled={busy}
          onClick={cancel}
        >
          Lascia stare
        </button>
        <button
          type="button"
          className={`${ui.btn} ${ui.small} ${ui.dangerBtn}`}
          disabled={busy}
          onClick={confirm}
        >
          <Icon name="trash" size={16} />
          Sì, elimina
        </button>
      </div>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </div>
  );
}
