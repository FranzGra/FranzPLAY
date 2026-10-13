import { useEffect, useState } from "react";
import { Link } from "react-router";
import { avatarUrl } from "../../api/auth";
import { searchPeople } from "../../api/channels";
import type { SharePerson } from "../../api/people";
import { Avatar } from "../../components/Avatar";
import styles from "./PeopleFound.module.css";

// usePeopleFound returns the people whose name matches the search. When
// the server does not answer it stays empty: the videos found are the
// heart of the page, and they still show.
export function usePeopleFound(query: string): SharePerson[] {
  const [people, setPeople] = useState<SharePerson[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    searchPeople(query, controller.signal)
      .then(setPeople)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [query]);
  return people;
}

// PeopleFound shows the people found, each a link to their channel.
export function PeopleFound({ people }: { people: SharePerson[] }) {
  return (
    <section className={styles.section} aria-labelledby="people-found">
      <h2 id="people-found" className={styles.title}>
        Persone
      </h2>
      <ul className={styles.list}>
        {people.map((person) => (
          <li key={person.id}>
            <Link to={`/canale/${person.id}`} className={`glass ${styles.person}`}>
              <Avatar name={person.name} photo={avatarUrl(person.id, person.avatar)} size={36} />
              <span className={styles.name}>{person.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
