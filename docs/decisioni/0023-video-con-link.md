# 0023 · Video visibili a chi ha il link, e tutti i miei video sul mio canale

14 ottobre 2026.

## Cosa si è deciso

Un video caricato dal browser ha ora quattro scelte su chi lo vede: **Tutti**, **Chi ha il
link**, **Alcune persone**, **Solo io**. «Chi ha il link» funziona come un video «non in elenco»
di YouTube: il video non compare in nessuna lista, e lo guarda chi apre il suo link, se ha un
account su questo FranzPLAY.

Sul **proprio canale** ognuno vede tutti i video che ha caricato, anche quelli privati, e su ogni
copertina c'è scritto chi lo vede: «Pubblico», «Chi ha il link», «Alcune persone», «Privato». Gli
altri, sullo stesso canale, vedono solo quelli pubblici.

## Perché così

- **Il link ha una parte segreta.** I numeri dei video sono in fila (12, 13, 14…) e si
  indovinano: il link è `/video/12?k=…`, con 22 lettere casuali (`videos.link_key`) che nessuno
  può indovinare.
- **Aprire il link vale come un invito.** Quando qualcuno apre il link, l'interfaccia lo dice al
  server (`POST /api/videos/{id}/link`), che se lo segna in `video_link_viewers` insieme alla
  chiave usata. Da lì in poi il controllo resta uno solo (`watchable` in `internal/catalog`):
  pagina, streaming, sottotitoli, audio, mi piace e commenti funzionano come per «Alcune persone».
- **Togliere il link toglie l'accesso.** Se chi ha caricato il video sceglie un'altra opzione, la
  chiave sparisce; se poi torna a «Chi ha il link», la chiave è nuova. Chi aveva il link vecchio
  non lo apre più, senza dover cancellare niente.
- **Serve comunque un account.** FranzPLAY è una casa su invito: un link non apre le porte a chi
  non è entrato. Aprire video a chi non ha un account sarebbe un'altra decisione, più grande.
- **Una scelta sola alla volta.** Un video con il link non ha persone scelte, e viceversa: due
  modi insieme renderebbero difficile capire chi lo vede.
- **La scritta sul canale la vede solo chi ha caricato il video.** Il server la manda
  (`audience`) solo a lui, e solo nella lista del suo canale e nella pagina del video; il link
  (`link`) solo nella pagina del video e in «I tuoi video».

Le playlist restano con tre scelte: una playlist non ha link.
