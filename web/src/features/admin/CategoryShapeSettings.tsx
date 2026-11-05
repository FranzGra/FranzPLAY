import { useState } from "react";
import { type CategoryShape, categoryShapes, saveLook } from "../../api/site";
import { useSite } from "../../app/site";
import pages from "./Pages.module.css";
import { Card, ui } from "./ui";

// CategoryShapeSettings chooses the shape of the covers of every category,
// on the Categories page and in the administrator's preview. It stands on
// the administrator's Categories page, where the categories are managed:
// the preview there changes at once. It is saved at once, as one of the
// choices of the site, and everybody sees it.
export function CategoryShapeSettings() {
  const site = useSite();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const shape = site.look.categoryShape;

  const choose = (next: CategoryShape) => {
    if (next === shape || busy) return;
    setBusy(true);
    setProblem("");
    saveLook({ ...site.look, categoryShape: next })
      .then((saved) => site.changed(saved))
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  if (!site.ready) return null;
  return (
    <Card title="Copertine delle categorie" icon="categories">
      <p className={ui.cardText}>
        La forma di tutte le copertine delle categorie. Le immagini si adattano tagliando i bordi,
        senza deformarsi.
      </p>
      <fieldset className={ui.segmented} disabled={busy} aria-busy={busy || undefined}>
        <legend className="visually-hidden">Forma delle copertine</legend>
        {categoryShapes.map((s) => (
          <label key={s.id} className={ui.segment}>
            <input
              type="radio"
              name="category-shape"
              className="visually-hidden"
              value={s.id}
              checked={shape === s.id}
              onChange={() => choose(s.id)}
            />
            <span className={pages.shapeIcon} data-shape={s.id} aria-hidden="true" />
            {s.label} ({s.ratio})
          </label>
        ))}
      </fieldset>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </Card>
  );
}
