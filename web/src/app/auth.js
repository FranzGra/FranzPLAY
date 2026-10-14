import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchMe, fetchSetup, logout } from "../api/auth";
import { onUnauthorized } from "../api/client";
import { applyAccent } from "./accent";
import { useSite } from "./site";
// signedOut is the state after losing the session while the page is open.
// Whether anyone may register is not known then: the login page offers it
// again once the page is reloaded.
const signedOut = {
    kind: "signed-out",
    setupNeeded: false,
    setupCodeNeeded: false,
    openRegistration: false,
};
const AuthContext = createContext(null);
// AuthProvider asks the server who is logged in when the page opens, and
// keeps the answer for every page.
export function AuthProvider({ children }) {
    const [state, setState] = useState({ kind: "loading" });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        void attempt; // a new attempt asks again
        const controller = new AbortController();
        load(controller.signal)
            .then(setState)
            .catch((error) => {
            if (!controller.signal.aborted) {
                console.error(error);
                setState({ kind: "error" });
            }
        });
        return () => controller.abort();
    }, [attempt]);
    // Each person sees FranzPLAY in the color they chose; the login page, and
    // whoever did not choose, in the site's color set by the administrator.
    const siteColor = useSite().look.color;
    const accent = (state.kind === "signed-in" && state.account.accentColor) || siteColor;
    useEffect(() => {
        applyAccent(accent);
        return () => applyAccent("");
    }, [accent]);
    // A session that expires while the page is open sends back to the login.
    useEffect(() => onUnauthorized(() => setState((current) => (current.kind === "signed-in" ? signedOut : current))), []);
    const signedIn = useCallback((account) => setState({ kind: "signed-in", account }), []);
    const signOut = useCallback(async () => {
        await logout();
        // The login page shown next asks again whether anyone may register;
        // if the server does not say, it just does not offer it.
        const setup = await fetchSetup().catch((error) => {
            console.error(error);
            return { openRegistration: false };
        });
        setState({ ...signedOut, openRegistration: setup.openRegistration });
    }, []);
    const sessionClosed = useCallback(() => setState(signedOut), []);
    const retry = useCallback(() => {
        setState({ kind: "loading" });
        setAttempt((n) => n + 1);
    }, []);
    return (_jsx(AuthContext.Provider, { value: { state, signedIn, signOut, sessionClosed, retry }, children: children }));
}
async function load(signal) {
    const account = await fetchMe(signal);
    if (account) {
        return { kind: "signed-in", account };
    }
    const setup = await fetchSetup(signal);
    return {
        kind: "signed-out",
        setupNeeded: setup.needed,
        setupCodeNeeded: setup.codeNeeded,
        openRegistration: setup.openRegistration,
    };
}
export function useAuth() {
    const value = useContext(AuthContext);
    if (!value) {
        throw new Error("useAuth must be used inside AuthProvider");
    }
    return value;
}
// useAccount returns the logged-in user, for pages shown only after login.
export function useAccount() {
    const { state } = useAuth();
    if (state.kind !== "signed-in") {
        throw new Error("useAccount used while nobody is logged in");
    }
    return state.account;
}
