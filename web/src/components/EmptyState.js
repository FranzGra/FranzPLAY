import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "./EmptyState.module.css";
// EmptyState explains what will appear on a page that has nothing to show yet.
export function EmptyState({ title, children, headingLevel = 2 }) {
    const Heading = headingLevel === 1 ? "h1" : "h2";
    return (_jsxs("div", { className: `glass ${styles.root}`, children: [_jsx(Heading, { className: styles.title, children: title }), _jsx("p", { className: styles.text, children: children })] }));
}
