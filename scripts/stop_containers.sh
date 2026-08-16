#!/bin/bash

# ============================================================================
# FranzPLAY - Stop Ambiente Docker (Unix/Mac)
# ============================================================================

# Posizionati nella root del progetto (cartella padre di /scripts)
cd "$(dirname "$0")/.." || exit 1

echo "🛑 Fermo i container Docker..."
docker compose stop

echo "✅ Container fermati."
