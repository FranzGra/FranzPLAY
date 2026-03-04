#!/bin/bash

echo ""
echo "ATTENZIONE: Questa un'operazione distruttiva!"
echo "Verranno cancellati tutti i container, i volumi e i file del database."
echo "Il file .env e la cartella App_Data verranno ripristinati."
echo ""
read -p "Premi Invio per continuare oppure CTRL+C per annullare..."

docker-compose down --volumes
docker-compose rm -fsv

echo "Rimozione file locali del database in corso (App_Data/Database_Data)..."
if [ -d "App_Data/Database_Data" ]; then
    rm -rf "App_Data/Database_Data"
fi

docker-compose build

if [ ! -d "App_Data/Database_Data" ]; then
    mkdir -p "App_Data/Database_Data"
fi

docker-compose up -d
docker-compose up -d

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
