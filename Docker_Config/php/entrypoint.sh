#!/bin/sh
set -e

# ============================================================================
# ENTRYPOINT SCRIPT PER PHP-FPM
# ============================================================================
# Viene eseguito ad ogni accensione del container.
# Risolve il problema del montaggio volumi di Docker che acquisiscono 
# automaticamente permessi di ROOT bloccando www-data (il nostro PHP).

APP_DATA="/App_Data"

echo "✨ [Entrypoint] Inizializzazione Ambiente Backend..."

# 1. Creiamo l'alberatura se non esiste
echo "📁 [Entrypoint] Controllo directory strutturali in ${APP_DATA}..."
mkdir -p "${APP_DATA}/Sessions"
mkdir -p "${APP_DATA}/User_Images"

# 2. Resettiamo il proprietario permettendo lettura/scrittura a PHP
echo "🔑 [Entrypoint] Allineamento privilegi per l'utente www-data..."
chown -R www-data:www-data "${APP_DATA}"

# 3. Permessi opzionali per cartella Video (se montata come variabile env)
if [ -n "$WATCH_DIR" ] && [ -d "$WATCH_DIR" ]; then
    echo "🎬 [Entrypoint] Configuro permessi per la libreria Video in $WATCH_DIR..."
    # Se i volumi video sono read-only nel NAS, questo comando potrebbe fallire
    # aggiungiamo "|| true" per non bloccare l'avvio in tal caso.
    chown -R www-data:www-data "$WATCH_DIR" || true
fi

echo "🚀 [Entrypoint] Avvio del server PHP-FPM in corso..."

# 4. Passa l'esecuzione al comando originale di base (es. php-fpm)
exec "$@"
