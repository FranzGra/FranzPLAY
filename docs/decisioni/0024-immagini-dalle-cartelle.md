# 0024 · Copertine e immagini delle categorie dalle cartelle dei video

28 ottobre 2026.

## Cosa si è deciso

- **Video**: un'immagine con lo stesso nome del video (`mare.jpg`, `mare-poster.png`,
  `mare-thumb.webp`, `mare-cover.jpg`…) è la sua copertina, e nessun fotogramma viene preso dal
  video. Esisteva già, ma l'immagine veniva cercata solo quando il video arrivava o cambiava. Ora
  il controllo delle cartelle (ogni minuto) se ne accorge anche dopo: immagine aggiunta,
  sostituita o tolta, e la copertina viene rifatta da sola. Maiuscole e minuscole non contano.
- **Categorie**: un'immagine chiamata come in Jellyfin e Kodi (`poster.jpg`, `cover.jpg`,
  `folder.jpg`, `categoria.jpg`… per quella verticale; `fanart.jpg`, `backdrop.jpg`,
  `landscape.jpg`… per quella orizzontale) nella cartella della categoria diventa la sua
  immagine. Una categoria può averne due: una verticale e una orizzontale.

Tutti i nomi sono in [Copertine e anteprime](../copertine-e-anteprime.md).

## Perché così

- **Regola 1 rispettata.** Le immagini nella cartella video vengono solo lette. Quello che serve
  alle pagine (la copertina a 640 pixel, la copia leggera della categoria a 1280 pixel al massimo)
  va nella cartella dati.
- **Accorgersi dei cambi costa quasi niente.** Il controllo delle cartelle passa già da ogni
  file: ora si segna anche le immagini, con dimensione e data. Per ogni video salva una "versione"
  dell'immagine accanto (`videos.cover_image`); se cambia, chiede di rifare la copertina. Nessun
  file viene letto in più quando niente cambia.
- **La forma la decide l'immagine.** Chi mette `categoria.jpg` non deve sapere se "categoria" vuol
  dire verticale o orizzontale: FranzPLAY guarda se l'immagine è più larga che alta. Il nome serve
  solo a scegliere tra più immagini della stessa forma.
- **Copia leggera, fatta subito.** Una foto del telefono pesa 3-5 MB: in una pagina con dieci
  categorie, sul telefono, sarebbero 50 MB. ffmpeg ne fa una copia JPEG di poche centinaia di KB
  appena il controllo delle cartelle la trova. È un lavoro piccolo (meno di un secondo anche su un
  Raspberry), per questo non passa dalla coda dei lavori pesanti, che è fatta per un video alla
  volta: lo fa il controllo delle cartelle stesso, un'immagine alla volta.
- **Un file che non è un'immagine** viene lasciato stare finché non cambia (o fino al prossimo
  avvio), senza riprovarlo ogni minuto.
- **La scelta dell'amministratore vince sempre**: la copertina scelta in Amministrazione ›
  Video e l'immagine caricata in Amministrazione › Categorie restano prima di quelle nelle cartelle.
