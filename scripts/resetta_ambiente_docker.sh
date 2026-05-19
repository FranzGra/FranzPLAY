#!/bin/bash

# ============================================================================
# FranzPLAY - Reset Ambiente Docker (Unix/Mac)
# ============================================================================
# Pulisce completamente i container, i volumi e i DATI del database.
# ATTENZIONE: Questa operazione è distruttiva!
# ============================================================================

# Posizionati nella root del progetto (cartella padre di /scripts)
cd "$(dirname "$0")/.." || exit 1

echo "⚠️ ATTENZIONE: Questa operazione cancellerà TUTTI i dati del database!"
read -p "Vuoi procedere? (s/N): " confirm

if [[ ! $confirm =~ ^[sS]$ ]]; then
    echo "Operazione annullata."
    exit 0
fi

echo "🧹 Fermo i container e rimuovo i volumi..."
docker compose down --volumes

echo "🗑️ Cancello fisicamente i dati del database locale..."
# sudo necessario in rootless: i file sono di uid mappato del container.
sudo rm -rf App_Data/Database_Data

echo "🚀 Ricostruzione e avvio ambiente..."
docker compose up -d --build

echo "✅ Ambiente resettato correttamente!"
