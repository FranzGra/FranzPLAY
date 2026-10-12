import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type Account, fetchMe, fetchSetup, logout } from "../api/auth";
import { onUnauthorized } from "../api/client";
import { applyAccent } from "./accent";

// AuthState is where the interface stands with the login.
export type AuthState =
  | { kind: "loading" }
  | { kind: "error" } // the server does not answer
  | { kind: "signed-out"; setupNeeded: boolean; openRegistration: boolean }
  | { kind: "signed-in"; account: Account };

type AuthContextValue = {
  state: AuthState;
  signedIn: (account: Account) => void;
  signOut: () => Promise<void>;
  sessionClosed: () => void; // the server already closed the session
  retry: () => void;
};

// signedOut is the state after losing the session while the page is open.
// Whether anyone may register is not known then: the login page offers it
// again once the page is reloaded.
const signedOut: Extract<AuthState, { kind: "signed-out" }> = {
  kind: "signed-out",
  setupNeeded: false,
  openRegistration: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

// AuthProvider asks the server who is logged in when the page opens, and
// keeps the answer for every page.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void attempt; // a new attempt asks again
    const controller = new AbortController();
    load(controller.signal)
      .then(setState)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setState({ kind: "error" });
        }
      });
    return () => controller.abort();
  }, [attempt]);

  // Each person sees FranzPLAY in the color they chose; the login page in
  // FranzPLAY's own.
  const accent = state.kind === "signed-in" ? state.account.accentColor : "";
  useEffect(() => {
    applyAccent(accent);
    return () => applyAccent("");
  }, [accent]);

  // A session that expires while the page is open sends back to the login.
  useEffect(
    () =>
      onUnauthorized(() =>
        setState((current) => (current.kind === "signed-in" ? signedOut : current)),
      ),
    [],
  );

  const signedIn = useCallback((account: Account) => setState({ kind: "signed-in", account }), []);
  const signOut = useCallback(async () => {
    await logout();
    // The login page shown next asks again whether anyone may register;
    // if the server does not say, it just does not offer it.
    const setup = await fetchSetup().catch((error: unknown) => {
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

  return (
    <AuthContext.Provider value={{ state, signedIn, signOut, sessionClosed, retry }}>
      {children}
    </AuthContext.Provider>
  );
}

async function load(signal: AbortSignal): Promise<AuthState> {
  const account = await fetchMe(signal);
  if (account) {
    return { kind: "signed-in", account };
  }
  const setup = await fetchSetup(signal);
  return {
    kind: "signed-out",
    setupNeeded: setup.needed,
    openRegistration: setup.openRegistration,
  };
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}

// useAccount returns the logged-in user, for pages shown only after login.
export function useAccount(): Account {
  const { state } = useAuth();
  if (state.kind !== "signed-in") {
    throw new Error("useAccount used while nobody is logged in");
  }
  return state.account;
}
