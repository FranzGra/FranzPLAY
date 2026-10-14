import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { EmptyState } from "../components/EmptyState";
import { useAuth } from "./auth";
import styles from "./StartupProblem.module.css";
// StartupProblem is shown when the server does not answer at all.
export function StartupProblem() {
    const { retry } = useAuth();
    return (_jsxs("main", { className: styles.root, children: [_jsx(EmptyState, { title: "Il server non risponde", headingLevel: 1, children: "Controlla che FranzPLAY sia acceso, poi riprova." }), _jsx("button", { type: "button", className: `glass ${styles.retry}`, onClick: retry, children: "Riprova" })] }));
}
