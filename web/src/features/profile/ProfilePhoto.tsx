import { type ReactNode, useRef, useState } from "react";
import { avatarUrl, removeAvatar, setAvatar } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAccount, useAuth } from "../../app/auth";
import { Avatar } from "../../components/Avatar";
import { PhotoCropper } from "./PhotoCropper";
import styles from "./ProfilePage.module.css";
import { type LoadedPhoto, loadPhoto, renderCrop } from "./photo";

// ProfilePhoto shows my photo (or my initial) and, under my name, the
// buttons to choose a new one, cropped round, or to take it away.
export function ProfilePhoto({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { signedIn } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const close = () => {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setSaving(false);
    setProblem("");
  };

  const choose = (file: File | undefined) => {
    if (!file) return;
    setProblem("");
    loadPhoto(file)
      .then(setPhoto)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Questa immagine non si apre. Prova con una foto JPG o PNG.");
      });
  };

  const save = (rect: { x: number; y: number; side: number }) => {
    if (!photo) return;
    setSaving(true);
    setProblem("");
    renderCrop(photo.url, rect)
      .then(setAvatar)
      .then((updated) => {
        signedIn(updated);
        close();
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setSaving(false);
      });
  };

  const remove = () => {
    setProblem("");
    removeAvatar()
      .then(signedIn)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
      });
  };

  return (
    <div className={styles.identity}>
      <Avatar name={account.name} size={64} photo={avatarUrl(account.id, account.avatar)} />
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className={styles.fileInput}
        aria-label="Scegli una foto"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = ""; // the same file can be chosen again
        }}
      />
      {photo && (
        <PhotoCropper
          photo={photo}
          saving={saving}
          problem={problem}
          onSave={save}
          onCancel={close}
        />
      )}
      <div>
        {children}
        <PhotoButtons
          hasPhoto={account.avatar > 0}
          onChoose={() => input.current?.click()}
          onRemove={remove}
          problem={photo ? "" : problem}
        />
      </div>
    </div>
  );
}

function PhotoButtons({
  hasPhoto,
  onChoose,
  onRemove,
  problem,
}: {
  hasPhoto: boolean;
  onChoose: () => void;
  onRemove: () => void;
  problem: string;
}) {
  return (
    <div className={styles.photoButtons}>
      <button type="button" className={styles.link} onClick={onChoose}>
        {hasPhoto ? "Cambia foto" : "Aggiungi una foto"}
      </button>
      {hasPhoto && (
        <button type="button" className={styles.link} onClick={onRemove}>
          Togli la foto
        </button>
      )}
      {problem && (
        <p role="alert" className={styles.formProblem}>
          {problem}
        </p>
      )}
    </div>
  );
}

function explain(error: unknown): string {
  if (!(error instanceof ApiError)) return "Il server non risponde. Riprova tra poco.";
  switch (error.status) {
    case 400:
    case 413:
      return "Questa foto non va bene. Prova con un'altra.";
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
