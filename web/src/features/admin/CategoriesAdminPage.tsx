import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AdminCategory,
  fetchAdminCategories,
  maxLabel,
  removeCategoryImage,
  saveCategory,
  uploadCategoryImage,
} from "../../api/adminCategories";
import { ApiError } from "../../api/client";
import { EmptyState } from "../../components/EmptyState";
import { formatVideos } from "../../lib/format";
import { type LoadedPhoto, loadPhoto } from "../profile/photo";
import styles from "./Admin.module.css";
import { CoverCropper } from "./CoverCropper";
import { renderCover } from "./coverImage";
import { presets } from "./LookFields";
import look from "./LookFields.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; list: AdminCategory[] };

// CategoriesAdminPage lets the administrator give each category the name
// people see, a color and an image. The videos and their folders do not
// change: only what people see.
export function CategoriesAdminPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback((signal?: AbortSignal) => {
    fetchAdminCategories(signal)
      .then((list) => setState({ kind: "ready", list }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Categorie non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  return (
    <>
      <p className={`${styles.lead} ${styles.count}`}>
        Le categorie sono le sottocartelle dei video, o quelle che scegli tu per un video. Qui
        decidi come le vedono tutti: un altro nome, un colore, un'immagine. Due categorie con lo
        stesso nome si vedono come una sola. Le cartelle non cambiano.
      </p>
      {state.list.length === 0 ? (
        <p className={styles.lead}>Ancora nessuna categoria.</p>
      ) : (
        <ul className={`stagger ${styles.list}`} aria-label="Categorie">
          {state.list.map((c) => (
            <li key={c.name}>
              <CategoryRow category={c} onChanged={() => load()} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CategoryRow({ category, onChanged }: { category: AdminCategory; onChanged: () => void }) {
  const [label, setLabel] = useState(category.label);
  const [color, setColor] = useState(category.color);
  const [picture, setPicture] = useState<LoadedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    if (!picture) return;
    return () => URL.revokeObjectURL(picture.url);
  }, [picture]);

  const run = (work: () => Promise<void>, ok: string) => {
    setBusy(true);
    setProblem("");
    setDone("");
    work()
      .then(() => {
        setPicture(null);
        setDone(ok);
        onChanged();
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(
          error instanceof ApiError && error.status === 400
            ? "Il nome o il colore non vanno bene: controlla e riprova."
            : "Non si è riusciti a salvare. Riprova tra poco.",
        );
      })
      .finally(() => setBusy(false));
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    run(() => saveCategory(category.name, label.trim(), color), "Salvato.");
  };

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProblem("");
    loadPhoto(file)
      .then(setPicture)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Questo file non sembra un'immagine. Prova con una foto JPEG o PNG.");
      });
  };

  const unchanged = label.trim() === category.label && color === category.color;
  const shown = category.label || category.name;
  return (
    <form
      className={`glass ${styles.person}`}
      onSubmit={send}
      aria-label={`Categoria ${category.name}`}
    >
      <div className={styles.videoInfo}>
        <span className={styles.thumb} style={color ? { boxShadow: `inset 4px 0 0 ${color}` } : {}}>
          {category.image && <img src={category.image} alt="" loading="lazy" />}
        </span>
        <div className={styles.failed}>
          <p className={styles.name}>{shown}</p>
          <p className={styles.role}>
            {category.label ? `Cartella: ${category.name} · ` : ""}
            {formatVideos(category.videos)}
          </p>
        </div>
      </div>
      <label className={styles.field}>
        Nome che vedono tutti
        <input
          value={label}
          maxLength={maxLabel}
          placeholder={category.name}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <fieldset className={look.colors}>
        <legend>Colore</legend>
        <button
          type="button"
          className={`${look.swatch} ${styles.noColor}`}
          aria-label="Nessun colore"
          aria-pressed={color === ""}
          title="Nessun colore"
          onClick={() => setColor("")}
        />
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            className={look.swatch}
            style={{ background: p.value }}
            aria-label={p.name}
            aria-pressed={color === p.value}
            title={p.name}
            onClick={() => setColor(p.value)}
          />
        ))}
        <label className={look.custom}>
          <input
            type="color"
            value={color || "#2997ff"}
            aria-label="Un altro colore"
            onChange={(e) => setColor(e.target.value.toLowerCase())}
          />
          Un altro
        </label>
      </fieldset>
      <div className={styles.buttons}>
        <button type="submit" className={styles.primary} disabled={busy || unchanged}>
          Salva nome e colore
        </button>
        <label className={`glass ${styles.action}`}>
          {category.image ? "Cambia immagine" : "Aggiungi un'immagine"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={styles.fileInput}
            disabled={busy}
            onChange={pick}
          />
        </label>
        {category.image && (
          <button
            type="button"
            className={`glass ${styles.action}`}
            disabled={busy}
            onClick={() => run(() => removeCategoryImage(category.name), "Immagine tolta.")}
          >
            Togli l'immagine
          </button>
        )}
      </div>
      {problem && !picture && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={styles.done}>
          {done}
        </p>
      )}
      {picture && (
        <CoverCropper
          picture={picture}
          saving={busy}
          problem={problem}
          title={`Immagine di ${shown}`}
          saveLabel="Usa questa immagine"
          onCancel={() => {
            setPicture(null);
            setProblem("");
          }}
          onSave={(rect) =>
            run(
              async () => uploadCategoryImage(category.name, await renderCover(picture.url, rect)),
              "Immagine salvata.",
            )
          }
        />
      )}
    </form>
  );
}
