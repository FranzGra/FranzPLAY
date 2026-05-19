#!/bin/bash

# Posizionati nella root del progetto (cartella padre di /scripts)
cd "$(dirname "$0")/.." || exit 1

docker-compose down

echo ""
echo ""
echo "===================================="
echo ""
echo "===== Container Docker STOPPATI ===="
echo ""
echo "===================================="
echo ""
echo ""

read -p "Premi Invio per uscire..."
