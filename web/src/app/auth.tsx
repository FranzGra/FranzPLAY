import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type Account, fetchMe, fetchSetupNeeded, logout } from "../api/auth";
import { onUnauthorized } from "../api/client";

// AuthState is where the interface stands with the login.
export type AuthState =
  | { kind: "loading" }
  | { kind: "error" } // the server does not answer
  | { kind: "signed-out"; setupNeeded: boolean }
  | { kind: "signed-in"; account: Account };

type AuthContextValue = {
  state: AuthState;
  signedIn: (account: Account) => void;
  signOut: () => Promise<void>;
  retry: () => void;
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

  // A session that expires while the page is open sends back to the login.
  useEffect(
    () =>
      onUnauthorized(() =>
        setState((current) =>
          current.kind === "signed-in" ? { kind: "signed-out", setupNeeded: false } : current,
        ),
      ),
    [],
  );

  const signedIn = useCallback((account: Account) => setState({ kind: "signed-in", account }), []);
  const signOut = useCallback(async () => {
    await logout();
    setState({ kind: "signed-out", setupNeeded: false });
  }, []);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <AuthContext.Provider value={{ state, signedIn, signOut, retry }}>
      {children}
    </AuthContext.Provider>
  );
}

async function load(signal: AbortSignal): Promise<AuthState> {
  const account = await fetchMe(signal);
  if (account) {
    return { kind: "signed-in", account };
  }
  return { kind: "signed-out", setupNeeded: await fetchSetupNeeded(signal) };
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
