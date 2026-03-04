#!/bin/bash

# ============================================================================
# FranzPLAY - Reset Ambiente Docker (Unix/Mac)
# ============================================================================
# Pulisce completamente i container, i volumi e i DATI del database.
# ATTENZIONE: Questa operazione è distruttiva!
# ============================================================================

echo "⚠️ ATTENZIONE: Questa operazione cancellerà TUTTI i dati del database!"
read -p "Vuoi procedere? (s/N): " confirm

if [[ ! $confirm =~ ^[sS]$ ]]; then
    echo "Operazione annullata."
    exit 0
fi

echo "🧹 Fermo i container e rimuovo i volumi..."
docker-compose down --volumes

echo "🗑️ Cancello fisicamente i dati del database locale..."
rm -rf App_Data/Database_Data

echo "🚀 Ricostruzione e avvio ambiente..."
docker-compose up -d --build

echo "✅ Ambiente resettato correttamente!"
