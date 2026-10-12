# 0010 · Inviti per familiari e amici

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Il problema

Finora l'amministratore doveva creare lui ogni account, scegliere una password e poi dirla
all'altra persona. È scomodo, e una password passata a voce o per messaggio non è più segreta.

## Cosa abbiamo deciso

- In **Amministrazione › Inviti** l'amministratore crea un **link d'invito**. Può scrivere per chi
  è (per ricordarselo) e dire se quella persona potrà caricare video.
- Chi apre il link sceglie **da solo** nome e password ed entra subito, come utente normale.
- Ogni link vale per **una persona sola** e funziona per **7 giorni**. L'amministratore può
  annullarlo prima.
- L'elenco dice di ogni invito se **aspetta**, chi l'ha **usato** o se è **scaduto**.

## Perché così

**Come le sessioni**, il database tiene solo l'**impronta** del codice (SHA-256), non il codice.
Chi legge il database non può usare un invito. Per lo stesso motivo il link si vede **una volta
sola**, appena creato: se si perde, se ne crea un altro.

Il codice sta **dopo il `#`** nell'indirizzo (`/invito#codice`). I browser non mandano mai quella
parte al server, così il codice non finisce nei log.

L'invito si **controlla due volte**:
- La prima prima di calcolare la password, così i codici inventati non costano niente al
  Raspberry.
- La seconda nello stesso momento in cui si crea l'account (in una transazione, cioè «tutto o
  niente»), così un link non crea mai due account.

Un errore nel modulo (nome già preso, password corta) **non consuma** l'invito.

Chi è già dentro e apre un link d'invito non crea un secondo account: la pagina gli dice di
mandarlo a chi vuole invitare.

## Cosa resta per dopo

- Video e playlist visibili **solo a chi scegli** (l'altra metà di «Lo condivido»).
