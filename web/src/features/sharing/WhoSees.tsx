import { useEffect, useId, useState } from "react";
import { avatarUrl } from "../../api/auth";
import { fetchPeople, type SharePerson } from "../../api/people";
import { Avatar } from "../../components/Avatar";
import type { Audience, Choice } from "./audience";
import styles from "./WhoSees.module.css";

// Hints say, under the three options, what each one means for this thing.
export type Hints = Record<Audience, string>;

const labels: Record<Audience, string> = {
  everyone: "Tutti",
  me: "Solo io",
  people: "Alcune persone",
};

// WhoSees chooses who sees something: everybody, only me, or the people I
// tick in the list that opens under "Alcune persone".
export function WhoSees({
  choice,
  onChange,
  hints,
}: {
  choice: Choice;
  onChange: (choice: Choice) => void;
  hints: Hints;
}) {
  const group = useId();
  return (
    <fieldset className={styles.root}>
      <legend>Chi può vederlo</legend>
      <div className={styles.choices}>
        {(["everyone", "me", "people"] as const).map((audience) => (
          <label key={audience} className={styles.choice}>
            <input
              type="radio"
              name={group}
              checked={choice.audience === audience}
              onChange={() => onChange({ ...choice, audience })}
            />
            {labels[audience]}
          </label>
        ))}
      </div>
      <p className={styles.note}>{hints[choice.audience]}</p>
      {choice.audience === "people" && (
        <PeoplePicker
          chosen={choice.people}
          onChange={(people) => onChange({ ...choice, people })}
        />
      )}
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
