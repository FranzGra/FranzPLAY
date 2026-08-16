#!/bin/bash

# ============================================================================
# FranzPLAY - Aggiornamento di un'installazione ESISTENTE (Linux / ZimaBlade)
# ============================================================================
# Porta un'installazione gia' in produzione all'ultima versione del codice
# SENZA perdere dati e senza toccare i video.
#
# PERCHE' SERVE:
# Docker esegue Docker_Config/DBMS_Iniziale/*.sql SOLO quando il volume MariaDB
# e' vergine. Su un server gia' avviato quei file non girano mai piu', quindi le
# colonne e le tabelle nuove non arriverebbero mai. I worker Python hanno una
# migrazione idempotente propria all'avvio, ma il backend PHP puo' partire prima
# di loro: questo script chiude la finestra applicando le migrazioni PRIMA che
# i servizi ripartano.
#
# E' IDEMPOTENTE: puoi rilanciarlo quante volte vuoi. Tutte le ALTER usano
# IF NOT EXISTS, gli INSERT sono IGNORE, le CREATE TABLE sono IF NOT EXISTS.
# Nessuna impostazione gia' scelta dall'admin viene sovrascritta.
#
# COSA NON TOCCA MAI (garanzia esplicita):
#   - la cartella dei video ($PERCORSO_VIDEO): nessun video, copertina,
#     anteprima o sottotitolo viene letto in scrittura o cancellato
#   - i volumi Docker: NON esegue mai `docker compose down`, tantomeno
#     `down --volumes`. Usa `up -d`, che ricrea i container lasciando
#     intatti i dati
#   - le tabelle esistenti: nessun DROP, DELETE o TRUNCATE
#   - le righe gia' presenti: gli unici UPDATE sono backfill su colonne
#     NUOVE ancora NULL
#
# ⚠️ NON confondere questo script con `reset.sh` o `resetta_ambiente_docker.sh`:
#    quelli fanno `docker compose down --volumes` e cancellano il database.
#    Non vanno MAI usati per aggiornare un'installazione esistente.
#
# USO:
#   cd /percorso/di/FranzPLAY
#   ./scripts/aggiorna.sh
# ============================================================================

set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

MIGRAZIONI="Docker_Config/DBMS_Iniziale/02_migrations.sql"
CARTELLA_BACKUP="App_Data/Backup_DB"

echo ""
echo "============================================================"
echo " FranzPLAY - Aggiornamento installazione esistente"
echo "============================================================"
echo ""

# ---------------------------------------------------------------------------
# 1. Controlli preliminari
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
    echo "❌ [ERRORE] File .env mancante nella root del progetto."
    exit 1
fi
if [ ! -f "$MIGRAZIONI" ]; then
    echo "❌ [ERRORE] File delle migrazioni non trovato: $MIGRAZIONI"
    exit 1
fi

# ---------------------------------------------------------------------------
# Configurazione di Docker CLI
# ---------------------------------------------------------------------------
# Docker scrive la propria configurazione (e lo stato di buildx) in
# $HOME/.docker. Lanciando lo script con sudo, $HOME diventa /root, che su
# ZimaOS e' in SOLA LETTURA: `docker compose build` falliva con
#   mkdir /root/.docker: read-only file system
# proprio all'ultimo passo, dopo backup e migrazioni.
#
# Se DOCKER_CONFIG e' gia' impostato lo rispettiamo; altrimenti proviamo a
# creare la cartella di default e, se non si puo', ne usiamo una dentro
# App_Data (ignorata da git e scrivibile da root).
if [ -z "${DOCKER_CONFIG:-}" ] && ! mkdir -p "${HOME:-/root}/.docker" 2>/dev/null; then
    DOCKER_CONFIG="$(pwd)/App_Data/.docker-config"
    export DOCKER_CONFIG
    mkdir -p "$DOCKER_CONFIG"
    echo "ℹ️  \$HOME non scrivibile: uso DOCKER_CONFIG=$DOCKER_CONFIG"
    echo ""
fi

# Leggiamo le credenziali dal .env senza esportare tutto l'ambiente:
# un .env con caratteri speciali non deve rompere lo script.
leggi_env() {
    grep -E "^${1}=" .env | tail -n1 | cut -d '=' -f2- | sed 's/^"//; s/"$//' || true
}

DB_NAME="$(leggi_env MYSQL_DATABASE)"
DB_ROOT_PWD="$(leggi_env MYSQL_ROOT_PASSWORD)"
if [ -z "$DB_NAME" ] || [ -z "$DB_ROOT_PWD" ]; then
    echo "❌ [ERRORE] MYSQL_DATABASE o MYSQL_ROOT_PASSWORD non trovate nel .env."
    exit 1
fi

echo "📦 Database:  $DB_NAME"
echo ""

# ---------------------------------------------------------------------------
# 2. Assicura che il database sia in piedi (serve solo lui per migrare)
# ---------------------------------------------------------------------------
# Il container si chiede a Docker Compose invece di ricostruirne il nome a mano:
# con CONTAINER_PREFIX valorizzato (caso ZimaBlade) indovinare la stringa e'
# fragile, e un nome sbagliato farebbe fallire l'aggiornamento a meta'.
CONTAINER_DB="$(docker compose ps -q mysql 2>/dev/null | head -n1)"

if [ -z "$CONTAINER_DB" ]; then
    echo "▶️  Il container del database non e' attivo: lo avvio..."
    docker compose up -d mysql
    CONTAINER_DB="$(docker compose ps -q mysql 2>/dev/null | head -n1)"
fi

if [ -z "$CONTAINER_DB" ]; then
    echo "❌ [ERRORE] Non riesco a individuare il container del database."
    echo "   Verifica di essere nella cartella del progetto e che il servizio"
    echo "   'mysql' esista in docker-compose.yml:  docker compose ps"
    exit 1
fi

echo "🐳 Container: $(docker inspect --format '{{.Name}}' "$CONTAINER_DB" 2>/dev/null | sed 's|^/||')"

echo "⏳ Attendo che MariaDB accetti connessioni..."
PRONTO=0
for i in $(seq 1 60); do
    if docker exec "$CONTAINER_DB" mariadb-admin ping -uroot -p"$DB_ROOT_PWD" --silent >/dev/null 2>&1; then
        PRONTO=1
        echo "✅ Database pronto (dopo ${i}s)."
        break
    fi
    sleep 1
done
if [ "$PRONTO" -ne 1 ]; then
    echo "❌ [ERRORE] MariaDB non risponde dopo 60s. Controlla: docker compose logs mysql"
    exit 1
fi

# ---------------------------------------------------------------------------
# 3. BACKUP (non negoziabile prima di una migrazione)
# ---------------------------------------------------------------------------
mkdir -p "$CARTELLA_BACKUP"
FILE_BACKUP="${CARTELLA_BACKUP}/backup_$(date +%Y%m%d_%H%M%S).sql"

echo ""
echo "💾 Backup del database in $FILE_BACKUP ..."
if docker exec "$CONTAINER_DB" mariadb-dump -uroot -p"$DB_ROOT_PWD" \
       --single-transaction --routines --events "$DB_NAME" > "$FILE_BACKUP" 2>/dev/null; then
    DIMENSIONE="$(du -h "$FILE_BACKUP" | cut -f1)"
    echo "✅ Backup completato ($DIMENSIONE)."
else
    echo "❌ [ERRORE] Backup fallito: mi fermo qui, non migro senza rete di sicurezza."
    rm -f "$FILE_BACKUP"
    exit 1
fi

# Teniamo solo gli ultimi 10 backup: su SD/SSD piccoli non serve di piu'.
#
# ⚠️ NIENTE xargs: su ZimaOS non e' installato. Con `set -e` la sua assenza
# interrompeva l'aggiornamento SUBITO DOPO il backup e PRIMA delle migrazioni,
# lasciando il sistema a meta' strada.
#
# La rotazione e' un'operazione accessoria: non deve mai poter fermare
# l'aggiornamento. Per questo usa solo shell builtin e non propaga errori.
ls -1t "${CARTELLA_BACKUP}"/backup_*.sql 2>/dev/null | tail -n +11 | while IFS= read -r vecchio; do
    rm -f "$vecchio" || true
done || true

# ---------------------------------------------------------------------------
# 4. Migrazioni idempotenti
# ---------------------------------------------------------------------------
echo ""
echo "🔧 Applico le migrazioni ($MIGRAZIONI)..."
if docker exec -i "$CONTAINER_DB" mariadb -uroot -p"$DB_ROOT_PWD" "$DB_NAME" < "$MIGRAZIONI"; then
    echo "✅ Migrazioni applicate."
else
    echo ""
    echo "❌ [ERRORE] Migrazione fallita. Il database NON e' stato modificato in modo"
    echo "   irreversibile (le ALTER sono idempotente e atomiche per statement),"
    echo "   ma per sicurezza puoi ripristinare con:"
    echo ""
    echo "   docker exec -i $CONTAINER_DB mariadb -uroot -p'***' $DB_NAME < $FILE_BACKUP"
    echo ""
    exit 1
fi

# ---------------------------------------------------------------------------
# 5. Verifica che lo schema atteso ci sia davvero
# ---------------------------------------------------------------------------
echo ""
echo "🔎 Verifica dello schema..."
docker exec -i "$CONTAINER_DB" mariadb -uroot -p"$DB_ROOT_PWD" "$DB_NAME" -N -B <<'SQL'
SELECT CONCAT(
  CASE WHEN COUNT(*) = 1 THEN '  [OK]  ' ELSE '  [!!]  ' END,
  'Metadati_Online.prossimo_tentativo_at')
 FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='Metadati_Online'
   AND COLUMN_NAME='prossimo_tentativo_at';
SELECT CONCAT(
  CASE WHEN COUNT(*) = 1 THEN '  [OK]  ' ELSE '  [!!]  ' END,
  'Video.copertina_origine')
 FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='Video'
   AND COLUMN_NAME='copertina_origine';
SELECT CONCAT(
  CASE WHEN COUNT(*) = 1 THEN '  [OK]  ' ELSE '  [!!]  ' END,
  'Tabella Metadati_Online')
 FROM INFORMATION_SCHEMA.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='Metadati_Online';
SELECT CONCAT(
  CASE WHEN COUNT(*) = 1 THEN '  [OK]  ' ELSE '  [!!]  ' END,
  'Tabella Sottotitoli')
 FROM INFORMATION_SCHEMA.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='Sottotitoli';
SELECT CONCAT(
  CASE WHEN COUNT(*) >= 15 THEN '  [OK]  ' ELSE '  [!!]  ' END,
  'Impostazioni modulo copertine (', COUNT(*), ' chiavi)')
 FROM Impostazioni
 WHERE Chiave_Impostazione LIKE 'copertine_online_%'
    OR Chiave_Impostazione = 'tpdb_api_token';
SQL

# ---------------------------------------------------------------------------
# 6. Rebuild e riavvio
# ---------------------------------------------------------------------------
echo ""
echo "🏗️  Ricostruzione delle immagini (solo cio' che e' cambiato)..."
docker compose build

echo ""
echo "🚀 Riavvio dei servizi..."
docker compose up -d

echo ""
echo "============================================================"
echo " ✅ Aggiornamento completato"
echo "============================================================"
echo ""
echo " Backup:  $FILE_BACKUP"
echo ""
echo " Controlli consigliati nei prossimi minuti:"
echo "   docker compose ps                      # tutti i servizi 'Up'"
echo "   docker compose logs -f php             # nessun errore di sessione"
echo "   docker compose logs -f python_worker_covers"
echo ""
