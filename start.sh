#!/bin/bash

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

if [ ! -d "App_Data/Database_Data" ]; then
    mkdir -p "App_Data/Database_Data"
fi

docker-compose up -d

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
