import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Link } from "react-router";
import { useAccount, useAuth } from "../../app/auth";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { AccentPicker } from "./AccentPicker";
import { DeleteAccount } from "./DeleteAccount";
import { NameForm } from "./NameForm";
import { PasswordForm } from "./PasswordForm";
import styles from "./ProfilePage.module.css";
import { ProfilePhoto } from "./ProfilePhoto";
import { useServerInfo } from "./useServerInfo";
const rows = (me) => [
    { to: `/canale/${me}`, label: "Il mio canale" },
    { to: "/cronologia", label: "Cronologia" },
];
const adminRows = [{ to: "/admin", label: "Amministrazione" }];
function versionText(state) {
    switch (state.kind) {
        case "loading":
            return "Controllo il server…";
        case "ready":
            return `FranzPLAY versione ${state.info.version}`;
        case "error":
            return "Il server non risponde.";
    }
}
export function ProfilePage() {
    usePageTitle("Profilo");
    const server = useServerInfo();
    const account = useAccount();
    const { signedIn, signOut } = useAuth();
    const [signOutFailed, setSignOutFailed] = useState(false);
    // At most one form is open, and the last change made is told below it.
    const [editing, setEditing] = useState(null);
    const [done, setDone] = useState("");
    function onSignOut() {
        setSignOutFailed(false);
        signOut().catch((error) => {
            console.error(error);
            setSignOutFailed(true);
        });
    }
    return (_jsxs("div", { className: styles.root, children: [_jsxs(ProfilePhoto, { children: [_jsx("h1", { className: styles.name, children: account.name }), _jsx("p", { className: styles.role, children: account.role === "admin" ? "Amministratore" : "Utente" })] }), account.canUpload ? (_jsxs(Link, { to: "/carica", className: styles.upload, children: [_jsx(Icon, { name: "upload", size: 20 }), "Carica un video"] })) : (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: styles.upload, disabled: true, "aria-describedby": "upload-hint", children: [_jsx(Icon, { name: "upload", size: 20 }), "Carica un video"] }), _jsx("p", { id: "upload-hint", className: styles.hint, children: "Per caricare video serve il permesso dell'amministratore." })] })), _jsx("nav", { className: `glass ${styles.rows}`, "aria-label": "Le tue pagine", children: [...rows(account.id), ...(account.role === "admin" ? adminRows : [])].map((row) => (_jsxs(Link, { to: row.to, className: styles.row, children: [row.label, _jsx("span", { className: styles.chevron, "aria-hidden": "true", children: "\u203A" })] }, row.to))) }), _jsx(AccentPicker, {}), _jsxs("section", { className: `glass ${styles.rows}`, "aria-label": "Il tuo account", children: [editing === null && (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: styles.row, onClick: () => {
                                    setDone("");
                                    setEditing("name");
                                }, children: ["Cambia nome", _jsx("span", { className: styles.chevron, "aria-hidden": "true", children: "\u203A" })] }), _jsxs("button", { type: "button", className: styles.row, onClick: () => {
                                    setDone("");
                                    setEditing("password");
                                }, children: ["Cambia password", _jsx("span", { className: styles.chevron, "aria-hidden": "true", children: "\u203A" })] })] })), _jsx("button", { type: "button", className: styles.row, onClick: onSignOut, children: "Esci" })] }), signOutFailed && (_jsx("p", { className: styles.signOutError, role: "alert", children: "Uscita non riuscita: il server non risponde. Riprova." })), editing === "name" && (_jsx(NameForm, { current: account.name, onDone: (renamed) => {
                    signedIn(renamed);
                    setEditing(null);
                    setDone("Nome cambiato. Da ora entri con il nome nuovo.");
                }, onCancel: () => setEditing(null) })), editing === "password" && (_jsx(PasswordForm, { onDone: () => {
                    setEditing(null);
                    setDone("Password cambiata. Sugli altri dispositivi dovrai entrare di nuovo.");
                }, onCancel: () => setEditing(null) })), done && (_jsx("p", { className: styles.hint, role: "status", children: done })), _jsx(DeleteAccount, {}), _jsx("p", { className: styles.version, role: "status", children: versionText(server) })] }));
}
