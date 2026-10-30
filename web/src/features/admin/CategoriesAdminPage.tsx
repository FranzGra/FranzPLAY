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
import { Icon } from "../../components/Icon";
import { formatVideos } from "../../lib/format";
import { usePresence } from "../../lib/presence";
import { CategoryTile } from "../categories/CategoryTile";
import { type LoadedPhoto, loadPhoto } from "../profile/photo";
import preview from "./CategoryPreview.module.css";
import { CoverCropper } from "./CoverCropper";
import { renderCover } from "./coverImage";
import { presets } from "./LookFields";
import look from "./LookFields.module.css";
import pages from "./Pages.module.css";
import { Card, Chip, Empty, Loading, PageHeader, Unavailable, ui } from "./ui";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; list: AdminCategory[] };

// CategoriesAdminPage lets the administrator give each category the name
// people see, a color and an image. On the left the categories, on the
// right the one being changed: the colors are shown once, not per card.
// The videos and their folders do not change: only what people see.
export function CategoriesAdminPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [chosen, setChosen] = useState("");

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

  const header = (
    <PageHeader
      title="Categorie"
      description="Le categorie sono le sottocartelle dei video, o quelle che scegli tu per un video. Qui decidi come le vedono tutti: un altro nome, un colore, un'immagine. Le cartelle non cambiano."
    />
  );
  if (state.kind === "loading") {
    return (
      <div className={ui.ui}>
        {header}
        <Loading />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={ui.ui}>
        {header}
        <Unavailable title="Categorie non disponibili" />
      </div>
    );
  }
  if (state.list.length === 0) {
    return (
      <div className={ui.ui}>
        {header}
        <Empty icon="categories" title="Ancora nessuna categoria">
          Una categoria nasce da sola quando una cartella di video ha delle sottocartelle, o quando
          scegli una categoria per un video dalla sua pagina di modifica.
        </Empty>
      </div>
    );
  }
  const current = state.list.find((c) => c.name === chosen) ?? state.list[0];
  return (
    <div className={ui.ui}>
      {header}
      <div className={pages.split}>
        <Card title="Tutte le categorie" icon="categories" sub={`${state.list.length}`}>
          <ul className={pages.pickList} aria-label="Categorie">
            {state.list.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  className={pages.pick}
                  aria-current={c.name === current?.name || undefined}
                  onClick={() => setChosen(c.name)}
                >
                  <span className={pages.catThumb}>
                    {c.image ? (
                      <img src={c.image} alt="" loading="lazy" />
                    ) : (
                      <Icon name="categories" size={18} />
                    )}
                  </span>
                  <span className={pages.pickText}>
                    <b>{c.label || c.name}</b>
                    <span>
                      {c.label ? `Cartella: ${c.name} · ` : ""}
                      {formatVideos(c.videos)}
                    </span>
                  </span>
                  <span
                    className={pages.dot}
                    style={c.color ? { background: c.color } : undefined}
                    data-none={c.color ? undefined : true}
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {current && (
          <CategoryEditor key={current.name} category={current} onChanged={() => load()} />
        )}
      </div>
    </div>
  );
}

function CategoryEditor({
  category,
  onChanged,
}: {
  category: AdminCategory;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState(category.label);
  const [color, setColor] = useState(category.color);
  const [picture, setPicture] = useState<LoadedPhoto | null>(null);
  // The window to fit the picture closes softly: it keeps the picture meanwhile.
  const cropper = usePresence(picture);
  const cropping = cropper.shown;
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

  const changed = label.trim() !== category.label || color !== category.color;
  const shown = label.trim() || category.name;
  return (
    <Card title={category.label || category.name} icon="edit" sub={formatVideos(category.videos)}>
      <form className={pages.editor} onSubmit={send} aria-label={`Categoria ${category.name}`}>
        <div className={preview.preview} aria-label="Come la vedono tutti" role="img">
          <CategoryTile
            name={shown}
            videos={category.videos}
            color={color}
            image={category.image ?? category.folderImage}
            poster={category.poster}
          />
        </div>

        <label className={ui.field}>
          <span className={ui.label}>Nome che vedono tutti</span>
          <input
            className={ui.input}
            value={label}
            maxLength={maxLabel}
            placeholder={category.name}
            onChange={(e) => setLabel(e.target.value)}
          />
          <span className={ui.hint}>
            Vuoto: si vede il nome della cartella, «{category.name}». Due categorie con lo stesso
            nome si vedono come una sola.
          </span>
        </label>

        <fieldset className={look.colors}>
          <legend className={ui.label}>Colore</legend>
          <button
            type="button"
            className={`${look.swatch} ${pages.noColor}`}
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

        <div className={pages.formFoot}>
          <div className={ui.chips}>
            <label className={ui.btn} aria-disabled={busy || undefined}>
              <Icon name="upload" size={16} />
              {category.image ? "Cambia immagine" : "Aggiungi un'immagine"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className={ui.fileInput}
                disabled={busy}
                onChange={pick}
              />
            </label>
            {category.image && (
              <button
                type="button"
                className={`${ui.btn} ${ui.ghost}`}
                disabled={busy}
                onClick={() => run(() => removeCategoryImage(category.name), "Immagine tolta.")}
              >
                Togli l'immagine
              </button>
            )}
          </div>
          <div className={ui.chips}>
            {changed ? (
              <>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.ghost}`}
                  disabled={busy}
                  onClick={() => {
                    setLabel(category.label);
                    setColor(category.color);
                  }}
                >
                  Annulla
                </button>
                <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy}>
                  <Icon name="check" size={16} />
                  Salva nome e colore
                </button>
              </>
            ) : (
              <Chip tone="ok" icon="check">
                Nessuna modifica da salvare
              </Chip>
            )}
          </div>
        </div>

        {problem && !picture && (
          <p role="alert" className={ui.problem}>
            {problem}
          </p>
        )}
        {done && (
          <p role="status" className={ui.okText}>
            {done}
          </p>
        )}
      </form>
      {cropping && (
        <CoverCropper
          ref={cropper.ref}
          leaving={cropper.leaving}
          picture={cropping}
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
              async () => uploadCategoryImage(category.name, await renderCover(cropping.url, rect)),
              "Immagine salvata.",
            )
          }
        />
      )}
    </Card>
  );
}
