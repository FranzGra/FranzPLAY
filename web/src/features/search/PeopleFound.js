import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { avatarUrl } from "../../api/auth";
import { searchPeople } from "../../api/channels";
import { Avatar } from "../../components/Avatar";
import styles from "./PeopleFound.module.css";
// usePeopleFound returns the people whose name matches the search. When
// the server does not answer it stays empty: the videos found are the
// heart of the page, and they still show.
export function usePeopleFound(query) {
    const [people, setPeople] = useState([]);
    useEffect(() => {
        const controller = new AbortController();
        searchPeople(query, controller.signal)
            .then(setPeople)
            .catch((error) => {
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, [query]);
    return people;
}
// PeopleFound shows the people found, each a link to their channel.
export function PeopleFound({ people }) {
    return (_jsxs("section", { className: styles.section, "aria-labelledby": "people-found", children: [_jsx("h2", { id: "people-found", className: styles.title, children: "Persone" }), _jsx("ul", { className: styles.list, children: people.map((person) => (_jsx("li", { children: _jsxs(Link, { to: `/canale/${person.id}`, className: `glass ${styles.person}`, children: [_jsx(Avatar, { name: person.name, photo: avatarUrl(person.id, person.avatar), size: 36 }), _jsx("span", { className: styles.name, children: person.name })] }) }, person.id))) })] }));
}
