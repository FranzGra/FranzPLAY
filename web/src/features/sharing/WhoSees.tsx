import { useEffect, useId, useState } from "react";
import { avatarUrl } from "../../api/auth";
import { fetchPeople, type SharePerson } from "../../api/people";
import { Avatar } from "../../components/Avatar";
import { Icon, type IconName } from "../../components/Icon";
import type { Audience, Choice } from "./audience";
import { CopyLink } from "./CopyLink";
import styles from "./WhoSees.module.css";

// Hints say, under each option, what it means for this thing. Only the
// options with a hint are offered: a playlist has no link.
export type Hints = Partial<Record<Audience, string>>;

// From the most open to the most closed.
const options: { audience: Audience; label: string; icon: IconName }[] = [
  { audience: "everyone", label: "Tutti", icon: "globe" },
  { audience: "link", label: "Chi ha il link", icon: "link" },
  { audience: "people", label: "Alcune persone", icon: "people" },
  { audience: "me", label: "Solo io", icon: "lock" },
];

// WhoSees chooses who sees something: one card for each option, the chosen
// one lit. Under "Alcune persone" opens the list of people to tick; under
// "Chi ha il link", the link to copy once there is one (link), or before
// that linkLater, which says when it will be.
export function WhoSees({
  choice,
  onChange,
  hints,
  link = null,
  linkLater = "Il link da copiare comparirà appena salvi.",
  hideLegend = false,
}: {
  choice: Choice;
  onChange: (choice: Choice) => void;
  hints: Hints;
  link?: string | null;
  linkLater?: string;
  // hideLegend keeps the title for screen readers only, when a window
  // around the choice already says it.
  hideLegend?: boolean;
}) {
  const group = useId();
  return (
    <fieldset className={styles.root}>
      <legend className={hideLegend ? "visually-hidden" : undefined}>Chi può vederlo</legend>
      <div className={styles.options}>
        {options
          .filter((o) => hints[o.audience] !== undefined)
          .map((o) => {
            const chosen = choice.audience === o.audience;
            return (
              <div key={o.audience} className={`${styles.option} ${chosen ? styles.chosen : ""}`}>
                <label className={styles.head}>
                  <input
                    type="radio"
                    name={group}
                    checked={chosen}
                    aria-label={o.label}
                    aria-describedby={`${group}-${o.audience}`}
                    onChange={() => onChange({ ...choice, audience: o.audience })}
                  />
                  <span className={styles.icon}>
                    <Icon name={o.icon} size={20} />
                  </span>
                  <span className={styles.words}>
                    <span className={styles.label}>{o.label}</span>
                    <span className={styles.hint} id={`${group}-${o.audience}`}>
                      {hints[o.audience]}
                    </span>
                  </span>
                  <span className={styles.mark} aria-hidden="true">
                    {chosen && <Icon name="check" size={14} />}
                  </span>
                </label>
                {chosen && o.audience === "people" && (
                  <div className={styles.more}>
                    <PeoplePicker
                      chosen={choice.people}
                      onChange={(people) => onChange({ ...choice, people })}
                    />
                  </div>
                )}
                {chosen && o.audience === "link" && (
                  <div className={styles.more}>
                    {link === null ? (
                      <p className={styles.note}>{linkLater}</p>
                    ) : (
                      <CopyLink link={link} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </fieldset>
  );
}

type People = { kind: "loading" } | { kind: "error" } | { kind: "ready"; people: SharePerson[] };

// Past this many people, a box to find a name comes first.
const findFrom = 8;

// PeoplePicker is the list of people with a tick each.
function PeoplePicker({
  chosen,
  onChange,
}: {
  chosen: number[];
  onChange: (people: number[]) => void;
}) {
  const [state, setState] = useState<People>({ kind: "loading" });
  const [find, setFind] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchPeople(controller.signal)
      .then((people) => setState({ kind: "ready", people }))
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
      <p role="alert" className={styles.problem}>
        L'elenco delle persone non è disponibile: riprova tra poco.
      </p>
    );
  }
  if (state.people.length === 0) {
    return (
      <p className={styles.note}>
        Su FranzPLAY non c'è ancora nessun altro: quando arriverà qualcuno, potrai sceglierlo qui.
      </p>
    );
  }
  const toggle = (id: number) =>
    onChange(chosen.includes(id) ? chosen.filter((p) => p !== id) : [...chosen, id]);
  const wanted = find.trim().toLowerCase();
  const shown = state.people.filter((p) => wanted === "" || p.name.toLowerCase().includes(wanted));

  return (
    <div className={styles.picker}>
      {state.people.length > findFrom && (
        <input
          type="search"
          className={styles.find}
          placeholder="Cerca un nome"
          aria-label="Cerca un nome"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      )}
      <ul className={styles.people} aria-label="Persone">
        {shown.map((p) => (
          <li key={p.id}>
            <label className={styles.person}>
              <input
                type="checkbox"
                checked={chosen.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              <Avatar name={p.name} size={28} photo={avatarUrl(p.id, p.avatar)} />
              <span className={styles.name}>{p.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        {chosen.length === 0
          ? "Scegli almeno una persona."
          : chosen.length === 1
            ? "Hai scelto 1 persona."
            : `Hai scelto ${chosen.length} persone.`}
      </p>
    </div>
  );
}
