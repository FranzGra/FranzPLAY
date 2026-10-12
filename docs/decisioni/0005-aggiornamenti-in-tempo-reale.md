# 0005 · Aggiornamenti in tempo reale

**Data:** 12 ottobre 2026 · **Stato:** decisa

## Cosa abbiamo deciso

- Il browser tiene aperta **una sola connessione** con il server, `GET /api/events`, con gli
  **SSE** (Server-Sent Events: un modo standard in cui il server manda brevi messaggi al browser
  sulla stessa connessione, senza che il browser debba chiedere ogni volta).
- Il server dice **solo cosa è cambiato** (per ora `library`: video nuovi, spariti, letti o con
  copertina nuova), **non i dati**. La pagina che mostra quella cosa la chiede di nuovo, con le
  stesse chiamate di sempre.
- Tanti cambiamenti vicini diventano **un solo avviso**, e dopo un avviso il server aspetta un paio
  di secondi prima di mandarne un altro.

## Perché

**SSE e non WebSocket.** Gli SSE bastano: i messaggi vanno in una sola direzione (dal server al
browser), il browser si riconnette da solo se la linea cade e non serve nessuna libreria.

**Solo "cosa", non i dati.** Così c'è un solo modo di leggere i dati (le chiamate normali, già
controllate e testate) e ognuno vede solo quello che può vedere. Un avviso in più costa una
richiesta, uno perso non rompe niente.

**Avvisi raggruppati.** Una cartella con cento video nuovi non deve far ricaricare la pagina cento
volte: sul Raspberry conta.

**Un limite di pagine aperte** (64): oltre, il server risponde "occupato" invece di tenere aperte
connessioni senza fine.
