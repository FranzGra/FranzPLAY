import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Icon } from "../../components/Icon";
import styles from "./RemovableCard.module.css";
// RemovableCard is a video in a list (history, a playlist) with a button
// that takes it out. The button sits inside the card, at its right edge, so
// the two read as one piece and light up together under the mouse.
export function RemovableCard({ card, label, title, onRemove }) {
    return (_jsxs("div", { className: styles.root, children: [card, _jsx("button", { type: "button", className: styles.remove, "aria-label": label, title: title, onClick: onRemove, children: _jsx(Icon, { name: "close", size: 18 }) })] }));
}
