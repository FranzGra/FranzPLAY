import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { copyText } from "./copyText";
import styles from "./ShareButton.module.css";
// showOutcomeFor is how long "Link copiato" stays on the button.
const showOutcomeFor = 2500;
// ShareButton sends the address of a page: with the phone's own share
// panel when there is one, otherwise by copying it.
export function ShareButton({ title, path }) {
    const [outcome, setOutcome] = useState(null);
    useEffect(() => {
        if (outcome === null)
            return;
        const timer = window.setTimeout(() => setOutcome(null), showOutcomeFor);
        return () => window.clearTimeout(timer);
    }, [outcome]);
    async function share() {
        const url = new URL(path, window.location.origin).toString();
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title, url });
                return;
            }
            catch (error) {
                // Closing the panel is a choice, not a failure.
                if (error instanceof DOMException && error.name === "AbortError")
                    return;
                console.warn("share panel refused", error);
            }
        }
        try {
            await copyText(url);
            setOutcome("copied");
        }
        catch (error) {
            console.error(error);
            setOutcome("failed");
        }
    }
    return (_jsxs("div", { className: styles.root, children: [_jsxs("button", { type: "button", className: `glass ${styles.button}`, onClick: () => void share(), children: [_jsx(Icon, { name: outcome === "copied" ? "check" : "share", size: 20 }), outcome === "copied" ? "Link copiato" : "Condividi"] }), outcome === "failed" && (_jsx("p", { className: styles.problem, role: "alert", children: "Il link non si riesce a copiare: copialo dalla barra degli indirizzi." }))] }));
}
