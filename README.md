# FranzTube 📺

FranzTube è una piattaforma di video streaming self-hosted (clone YouTube/Netflix) progettata per essere leggera e performante, ottimizzata specificamente per hardware embedded come il **Raspberry Pi 4**.

## 🚀 Filosofia "Drop & Watch"
Il cuore del progetto è l'automazione: basta caricare un video via FTP/SMB nella cartella monitorata e il sistema gestisce tutto il resto (ingestione, metadati, generazione locandine/anteprime e streaming).

## ✨ Funzionalità Chiave
*   **Ottimizzazione RPi4**: Architettura progettata per risorse limitate (caching Redis, streaming Nginx zero-copy).
*   **Smart Resume**: Riprende la visione dal punto interrotto (-3 secondi di rewind context).
*   **Automazione Python**: 3 processi background (Watcher, Meta, Assets) gestiscono l'ingestione e la sincronizzazione del filesystem.
*   **Interfaccia Moderna**: Frontend reattivo in **React 19** (Vite) con **Tailwind CSS v4**.
*   **Sicurezza**: Autenticazione session-based, protezione anti-spam e gestione utenti/admin.

## 🛠️ Tech Stack
L'infrastruttura è definita via **Docker Compose** (7 container):

| Servizio | Tecnologie | Ruolo |
| :--- | :--- | :--- |
| **Frontend** | React 19, Vite 7 | UI/UX SPA, Hot-reload in dev |
| **Web Server** | Nginx Alpine | Gateway, SSL, Streaming Delegate |
| **Backend** | PHP 8.2 Nativo | API Stateless, Logica di business |
| **Database** | MariaDB (MySQL) | Persistenza dati strutturati |
| **Cache** | Redis Alpine | Caching Query & Sessioni PHP |
| **Automation** | Python 3.9 | Watcher Filesystem, FFmpeg processing |

## 📦 Installazione & Utilizzo

### Prerequisiti
*   Docker & Docker Compose installati.

### Avvio Rapido (Windows)
Utilizza gli script batch forniti per gestire il ciclo di vita dei container:

1.  **Avviare il server**:
    ```batch
    Avvia_Containers.bat
    ```
2.  **Arrestare il server**:
    ```batch
    Stop_Containers.bat
    ```
3.  **Reset totale** (Attenzione: cancella DB e volumi):
    ```batch
    resetta_ambiente_docker.bat
    ```

## 📂 Struttura Cartelle
*   `/Frontend`: Codice sorgente React.
*   `/Backend/api`: Endpoint PHP (API).
*   `/Backend/python_server`: Script di automazione (Watcher, Workers).
*   `/Docker_Config`: Dockerfile e configurazioni servizi (Nginx, PHP, ecc).
