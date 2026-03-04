#!/bin/bash

# ============================================================================
# FranzPLAY - Avvio Ambiente Docker (Unix/Mac)
# ============================================================================
# Verifica la presenza dei file necessari e avvia i container.
# ============================================================================

# 1. Verifica file .env
if [ ! -f .env ]; then
    echo "❌ [ERRORE] File .env mancante!"
    echo "=========================================================="
    echo "Il file .env è necessario per configurare il database."
    echo "Per favore, rinomina il file '.env.example' in '.env'"
    echo "e modificalo con le tue credenziali prima di continuare."
    echo "=========================================================="
    exit 1
fi

# 2. Avvio Container
echo "🚀 Avvio dei container Docker in corso..."
docker-compose up -d

echo "✅ Ambiente avviato correttamente!"
echo "Puoi accedere a FranzPLAY all'indirizzo: http://localhost"
