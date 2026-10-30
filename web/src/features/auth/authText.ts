import { type Method, nameProblem, passwordProblem } from "../../api/auth";
import { ApiError } from "../../api/client";
import { blockedText } from "./secret/wait";

// The texts people read when something goes wrong before they are inside
// FranzPLAY: shared by the login page and the first setup wizard.

export type Mode = "login" | "setup" | "register";

// checkSetup finds mistakes before asking the server.
export function checkSetup(name: string, password: string, confirm: string): string {
  const problem = nameProblem(name) || passwordProblem(password);
  if (problem) {
    return problem;
  }
  if (password !== confirm) {
    return "Le due password non sono uguali.";
  }
  return "";
}

const wrongWhat: Record<Method, string> = {
  password: "Nome o password sbagliati.",
  pin: "Nome o PIN sbagliati.",
  pattern: "Nome o sequenza sbagliati.",
};

// explain turns a refusal of the server into a sentence for people.
export function explain(error: unknown, mode: Mode, method: Method): string {
  if (!(error instanceof ApiError)) {
    return "Il server non risponde. Controlla che FranzPLAY sia acceso e riprova.";
  }
  switch (error.status) {
    case 400:
      if (mode === "login") return "Scrivi nome e password.";
      if (error.message.includes("method")) {
        return "Questo modo di entrare non è ammesso su questo server: scegline un altro.";
      }
      return "Il nome può contenere solo lettere, numeri, spazi, punti, trattini e trattini bassi.";
    case 401:
      return mode === "setup"
        ? "Il codice di installazione non è giusto. Copialo dal terminale."
        : wrongWhat[method];
    case 403:
      if (mode !== "register" || error.message === "request from another site") {
        return "Il server ha rifiutato la richiesta perché arriva da un indirizzo diverso da quello del sito. Se usi un proxy, controlla che passi l'indirizzo giusto.";
      }
      return "La registrazione è chiusa: per entrare chiedi un invito a chi gestisce FranzPLAY.";
    case 409:
      return mode === "register"
        ? "Questo nome lo usa già un'altra persona: scegline un altro."
        : "FranzPLAY ha già un amministratore: ricarica la pagina per accedere.";
    case 429:
      return mode === "register"
        ? "Troppi account nuovi da questa rete. Aspetta qualche minuto e riprova."
        : blockedText(error);
    default:
      return "Qualcosa è andato storto sul server. Riprova tra poco.";
  }
}
