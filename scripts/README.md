# 📜 Scripts FranzPLAY

Questa cartella raccoglie tutti gli script di utilità per **avviare, fermare e resettare** l'ambiente Docker di FranzPLAY.

Esistono **due famiglie** di script che fanno cose simili ma con stile diverso:

| Famiglia | Stile | Quando usarla |
|---|---|---|
| **Famiglia "Containers"** (con pause) | Più verbosa, mostra `docker ps`, attende `Invio` alla fine | **Uso interattivo / desktop**: doppio-clic, vuoi leggere l'output prima che la finestra si chiuda |
| **Famiglia "compatta"** (no pause) | Output minimale, esce subito | **Uso da terminale / CI / automazioni**: già stai in una shell, non vuoi prompt bloccanti |

> Tutti gli script si auto-posizionano nella **root del progetto** (cartella padre di `/scripts`), quindi puoi lanciarli da qualunque directory: i path a `.env`, `App_Data/`, `docker-compose.yml` continuano a funzionare.

---

## 🪟 Windows (file `.bat`)

Lancia con **doppio-clic** dal File Explorer oppure da `cmd` / PowerShell.

### ▶️ Avviare l'ambiente
- **`Avvia_Containers.bat`** — Verifica che esista `.env`, crea `App_Data/Database_Data` se serve, lancia `docker-compose up -d`, mostra l'elenco container e attende `Invio`.
  - 👉 *Usa questo per il normale avvio quotidiano su Windows.*

### ⏹️ Fermare l'ambiente
- **`Stop_Containers.bat`** — Esegue `docker-compose down` (ferma e rimuove i container, **mantiene i dati**) e attende `Invio`.
  - 👉 *Usa questo per chiudere FranzPLAY a fine giornata senza perdere nulla.*

### 💣 Reset totale (DISTRUTTIVO)
- **`resetta_ambiente_docker.bat`** — Ferma i container, **rimuove i volumi**, cancella `App_Data/Database_Data`, rifà la build e riavvia da zero.
  - ⚠️ **Cancella TUTTO il database e i dati persistenti.**
  - 👉 *Usa questo solo se vuoi ripartire da un ambiente pulito (es. dopo modifiche al Dockerfile o per risolvere uno stato corrotto).*

---

## 🐧 Unix / macOS / Linux (file `.sh`)

Lancia da terminale con `bash scripts/nome.sh` (oppure `chmod +x scripts/*.sh` e poi `./scripts/nome.sh`).

Esistono **due varianti** per ogni operazione: una **interattiva** (con pause stile `.bat`) e una **compatta** (snella, no pause).

### ▶️ Avviare l'ambiente
| Script | Stile | Quando usarlo |
|---|---|---|
| **`start.sh`** | Interattivo (pause, `docker ps`, prompt `Invio`) | Quando vuoi vedere lo stato a colpo d'occhio dopo l'avvio, simile al `.bat` di Windows |
| **`avvia_containers.sh`** | Compatto (solo messaggi essenziali, niente prompt) | Quando lo lanci da terminale o lo includi in altri script / CI |

### ⏹️ Fermare l'ambiente
| Script | Cosa fa | Quando usarlo |
|---|---|---|
| **`stop.sh`** | `docker-compose down` (rimuove i container, mantiene i volumi) + pausa interattiva | Stop "completo" del normale flusso quotidiano, con conferma a video |
| **`stop_containers.sh`** | `docker-compose stop` (mette in pausa i container, **non li rimuove**) | Quando vuoi solo **sospendere** temporaneamente senza distruggere i container — riavvio più veloce con `docker-compose start` |

> 🔍 **Differenza chiave**: `down` rimuove i container, `stop` li congela. `stop` è più veloce a riavviarsi ma se cambi `docker-compose.yml` ti serve comunque `down`.

### 💣 Reset totale (DISTRUTTIVO)
| Script | Stile | Quando usarlo |
|---|---|---|
| **`reset.sh`** | Interattivo, conferma con `Invio`, rebuild + avvio doppio, mostra `docker ps` | Reset "guidato" da desktop con feedback visivo |
| **`resetta_ambiente_docker.sh`** | Compatto, chiede `s/N`, esegue `up -d --build` in un colpo solo | Reset rapido da terminale o quando sai cosa stai facendo |

⚠️ **Entrambi cancellano `App_Data/Database_Data` e tutti i volumi: il database va perso.**

---

## 🤔 Quale script devo usare? (guida lampo)

- **«Voglio solo avviare FranzPLAY»**
  - Windows: `Avvia_Containers.bat`
  - Mac/Linux da terminale veloce: `avvia_containers.sh`
  - Mac/Linux con feedback dettagliato: `start.sh`

- **«Voglio spegnere FranzPLAY a fine giornata»**
  - Windows: `Stop_Containers.bat`
  - Mac/Linux: `stop.sh` (rimuove i container) oppure `stop_containers.sh` (li mette solo in pausa)

- **«Ho rotto qualcosa, voglio ripartire da zero»** ⚠️ *Perdi il database!*
  - Windows: `resetta_ambiente_docker.bat`
  - Mac/Linux: `resetta_ambiente_docker.sh` (rapido) oppure `reset.sh` (guidato)

- **«Sto modificando il `Dockerfile` o `docker-compose.yml`»**
  - Spesso basta `down` + `up -d --build`, ma se hai dubbi sui volumi conviene un reset completo.

---

## 📝 Note tecniche

- Tutti gli script richiedono che il file **`.env`** sia presente nella **root del progetto**. Se non c'è, gli script di avvio si fermano con un errore.
- I path interni sono relativi alla root del progetto: gli script eseguono automaticamente `cd "$(dirname "$0")/.."` (Unix) o `cd /d "%~dp0.."` (Windows) all'inizio.
- Gli `entrypoint.sh` presenti in `Docker_Config/php/` e `Frontend/` **NON** sono in questa cartella: vengono usati **dentro** i container Docker e devono restare dove sono.
