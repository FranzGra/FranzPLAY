#!/bin/bash

# Posizionati nella root del progetto (cartella padre di /scripts)
cd "$(dirname "$0")/.." || exit 1

# Verifica presenza file .env fondamentale per il db
if [ ! -f ".env" ]; then
    echo ""
    echo "[ERRORE] Il file .env non esiste in questa cartella!"
    echo "Per avviare FranzPLAY, per favore crea il file .env."
    echo "Puoi copiare il file .env.example e rinominarlo in .env."
    echo ""
    read -p "Premi Invio per uscire..."
    exit 1
fi

# NON creiamo manualmente Database_Data: in rootless Docker la directory
# va creata dal container con l'uid corretto del processo mysql, altrimenti
# l'utente mysql interno non riesce a scriverci e MariaDB fallisce l'init
# con "Permission denied". Lasciamo che sia docker compose up a crearla.

docker compose up -d

echo ""
echo "=================================="
echo "===== Elenco Container Docker ===="
echo "=================================="
echo ""

docker ps

echo ""
echo ""
echo "==================================="
echo ""
echo "===== Container Docker AVVIATI ===="
echo ""
echo "==================================="
echo ""
echo ""

read -p "Premi Invio per continuare..."
