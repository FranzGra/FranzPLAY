import type { ApiError } from "../../../api/client";

// waitText says a wait in words: "1 minuto", "15 minuti", "4 ore".
export function waitText(seconds: number): string {
  if (seconds < 60) return seconds <= 1 ? "1 secondo" : `${seconds} secondi`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minuto" : `${minutes} minuti`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "1 ora" : `${hours} ore`;
}

// blockedText explains a block of too many wrong tries, with its wait.
export function blockedText(error: ApiError): string {
  return error.retryAfter > 0
    ? `Troppi tentativi sbagliati. Per sicurezza l'accesso è bloccato: riprova tra ${waitText(error.retryAfter)}.`
    : "Troppi tentativi sbagliati. Aspetta qualche minuto e riprova.";
}
