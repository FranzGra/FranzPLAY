#!/bin/bash

# Posizionati nella root del progetto (cartella padre di /scripts)
cd "$(dirname "$0")/.." || exit 1

echo ""
echo "ATTENZIONE: Questa un'operazione distruttiva!"
echo "Verranno cancellati tutti i container, i volumi e i file del database."
echo "Il file .env e la cartella App_Data verranno ripristinati."
echo ""
read -p "Premi Invio per continuare oppure CTRL+C per annullare..."

docker compose down --volumes
docker compose rm -fsv

echo "Rimozione file locali del database in corso (App_Data/Database_Data)..."
if [ -d "App_Data/Database_Data" ]; then
    # Serve sudo perché i file appartengono a uid mappato del container (rootless),
    # non all'utente host.
    sudo rm -rf "App_Data/Database_Data"
fi

docker compose build

# IMPORTANTE: non creiamo manualmente Database_Data.
# Lasciamo che lo crei il container all'avvio con l'uid corretto del processo mysql.
# Crearla a mano qui significherebbe owner=franz e i container in rootless
# Docker non potrebbero scriverci dentro.

docker compose up -d

echo ""
echo "=================================="
echo "===== Elenco Container Docker ===="
echo "=================================="
echo ""

docker ps

echo ""
echo ""
echo "============================================"
echo ""
echo "===== Applicazione Docker Inizializzata ===="
echo ""
echo "============================================"
echo ""
echo ""

read -p "Premi Invio per uscire..."
