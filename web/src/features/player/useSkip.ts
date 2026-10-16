import { useCallback } from "react";
import { setSkipSeconds } from "../../api/auth";
import { useAuth } from "../../app/auth";
import { defaultSkip } from "./controls";

// useSkip gives the Player how far the logged-in person likes it to jump,
// and how to change it. The choice is saved on the server, so it follows
// the person on every device. It shows at once; if the server refuses,
// it goes back.
export function useSkip(): { skip: number; onSkip?: (seconds: number) => void } {
  const { state, signedIn } = useAuth();
  const account = state.kind === "signed-in" ? state.account : null;
  const onSkip = useCallback(
    (seconds: number) => {
      if (!account) return;
      signedIn({ ...account, skipSeconds: seconds });
      setSkipSeconds(seconds)
        .then(signedIn)
        .catch((error: unknown) => {
          console.error(error);
          signedIn(account);
        });
    },
    [account, signedIn],
  );
  if (!account) return { skip: defaultSkip };
  return { skip: account.skipSeconds, onSkip };
}
