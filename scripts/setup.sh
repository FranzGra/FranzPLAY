#!/bin/bash
# ============================================================================
# FranzPLAY - Setup & Avvio Automatico
# ============================================================================
# Script "tutto-in-uno" per il primo avvio O per fixare un'installazione rotta.
#
# Cosa fa, in ordine:
#   1. Verifica prerequisiti (file .env, docker compose, sysctl per rootless)
#   2. Rileva l'UID dell'utente "mysql" dentro al container MariaDB
#   3. Allinea proprietario e permessi di TUTTE le cartelle dati persistenti
#      (Database_Data, User_Images, Sessions) all'UID rilevato.
#   4. Avvia MariaDB per primo, aspetta che sia healthy.
#   5. Avvia il resto dei container.
#   6. Mostra stato finale e URL.
#
# SICURO: non cancella mai dati. Se Database_Data esiste e ha contenuti
# legittimi, li tiene. Se è vuota o assente, viene creata dal container.
#
# Uso: ./scripts/setup.sh
# ============================================================================

set -eo pipefail

# Colori per UX (solo se terminale supporta)
if [ -t 1 ]; then
    R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'; B='\033[0;34m'; N='\033[0m'
else
    R=''; G=''; Y=''; B=''; N=''
fi

log_step()  { echo -e "\n${B}━━━ $1 ━━━${N}"; }
log_ok()    { echo -e "${G}✓${N} $1"; }
log_warn()  { echo -e "${Y}⚠${N} $1"; }
log_err()   { echo -e "${R}✗${N} $1" >&2; }
log_info()  { echo -e "  $1"; }

# Posizionati nella root del progetto (cartella padre di /scripts)
cd "$(dirname "$0")/.." || { log_err "Impossibile entrare nella root del progetto"; exit 1; }
PROJECT_ROOT="$(pwd)"

# ============================================================================
# STEP 1: Prerequisiti
# ============================================================================
log_step "1/6  Verifica prerequisiti"

# 1.1 - docker e docker compose disponibili?
if ! command -v docker >/dev/null 2>&1; then
    log_err "Docker non è installato. Installalo prima di proseguire."
    exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
    log_err "Plugin 'docker compose' non disponibile. Su Debian/Ubuntu: sudo apt install docker-compose-plugin"
    exit 1
fi
log_ok "Docker e docker compose disponibili"

# 1.2 - File .env esiste?
if [ ! -f .env ]; then
    log_err "File .env mancante!"
    log_info "Copia .env.example in .env e personalizza le credenziali:"
    log_info "  cp .env.example .env && nano .env"
    exit 1
fi
log_ok "File .env presente"

# 1.3 - PERCORSO_VIDEO esiste sul filesystem?
PERCORSO_VIDEO=$(grep -E '^PERCORSO_VIDEO=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -z "$PERCORSO_VIDEO" ]; then
    log_warn "PERCORSO_VIDEO non definito in .env, useremo ./testVideo"
    PERCORSO_VIDEO="./testVideo"
fi
if [ ! -d "$PERCORSO_VIDEO" ]; then
    log_warn "PERCORSO_VIDEO ($PERCORSO_VIDEO) non esiste, lo creo"
    mkdir -p "$PERCORSO_VIDEO"
fi
log_ok "PERCORSO_VIDEO = $PERCORSO_VIDEO"

# 1.4 - Sysctl per porte privilegiate (solo se Docker rootless e siamo su Linux)
if [ "$(uname)" = "Linux" ] && systemctl --user is-active docker >/dev/null 2>&1; then
    CURRENT_LIMIT=$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || echo "1024")
    if [ "$CURRENT_LIMIT" -gt 80 ] 2>/dev/null; then
        log_warn "Docker rootless rilevato ma net.ipv4.ip_unprivileged_port_start=$CURRENT_LIMIT"
        log_info "Nginx non può aprire la porta 80. Applichiamo il fix:"
        if [ ! -f /etc/sysctl.d/99-docker-rootless.conf ]; then
            echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-docker-rootless.conf >/dev/null
            sudo sysctl --system >/dev/null 2>&1 || true
            log_ok "Sysctl aggiornato (porta 80 ora utilizzabile da utente non-root)"
        else
            log_info "File /etc/sysctl.d/99-docker-rootless.conf già esiste, controlla manualmente"
        fi
    else
        log_ok "Porte privilegiate accessibili (limit=$CURRENT_LIMIT)"
    fi
fi

# 1.5 - Verifica architettura immagini Docker esterne.
# Rileva quando un'immagine in cache è per un'architettura diversa da quella
# del Pi (succede se l'immagine è stata pullata su un altro host e copiata,
# o se un manifest multi-arch è stato risolto male). Ri-pulla se necessario.
HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
    aarch64|arm64) DOCKER_PLATFORM="linux/arm64" ;;
    armv7l)        DOCKER_PLATFORM="linux/arm/v7" ;;
    x86_64|amd64)  DOCKER_PLATFORM="linux/amd64" ;;
    *)             DOCKER_PLATFORM="" ;;
esac
log_ok "Architettura host: $HOST_ARCH (platform=$DOCKER_PLATFORM)"

if [ -n "$DOCKER_PLATFORM" ]; then
    # Lista immagini esterne usate dal compose (parse banale, abbastanza affidabile).
    # Strip righe vuote e righe che non sono reference di immagini (es. commenti).
    EXT_IMAGES=$(grep -E '^\s+image:\s+\S+' docker-compose.yml | awk '{print $2}' | grep -v '^$' | sort -u)
    for img in $EXT_IMAGES; do
        # Skip stringhe vuote o malformate
        [ -z "$img" ] && continue
        case "$img" in
            *:*|*/*) ;;  # ok, ha tag o repo
            *) continue ;;  # nome strano, skip
        esac
        # Verifica se l'immagine è in cache e con quale arch
        CACHED_ARCH=$(docker image inspect "$img" --format '{{.Os}}/{{.Architecture}}{{if .Variant}}/{{.Variant}}{{end}}' 2>/dev/null || echo "")
        if [ -z "$CACHED_ARCH" ]; then
            log_info "Pull '$img' per $DOCKER_PLATFORM (non in cache)"
            docker pull --platform "$DOCKER_PLATFORM" "$img" >/dev/null 2>&1 || \
                log_warn "Pull di '$img' fallito (verrà ritentato da docker compose)"
        elif [ "$CACHED_ARCH" != "$DOCKER_PLATFORM" ]; then
            log_warn "'$img' in cache ha arch '$CACHED_ARCH' ≠ '$DOCKER_PLATFORM', rifaccio pull"
            docker rmi "$img" >/dev/null 2>&1 || true
            docker pull --platform "$DOCKER_PLATFORM" "$img" >/dev/null 2>&1 || \
                log_warn "Pull di '$img' fallito"
        else
            log_ok "'$img' ($CACHED_ARCH)"
        fi
    done
fi

# ============================================================================
# STEP 2: Rileva UID del processo mysql dentro al container
# ============================================================================
log_step "2/6  Rilevo UID corretto per mysql"

# Pull dell'immagine se manca (così possiamo eseguirla)
docker pull mariadb:11.4 >/dev/null 2>&1 || log_warn "Pull mariadb:11.4 fallito, uso immagine locale se presente"

# Estrai uid:gid dell'utente mysql interno
MYSQL_UID_GID=$(docker run --rm mariadb:11.4 sh -c 'id -u mysql && id -g mysql' 2>/dev/null | tr '\n' ':' | sed 's/:$//')
if [ -z "$MYSQL_UID_GID" ]; then
    log_err "Impossibile rilevare UID di mysql dal container. Uso fallback 999:999"
    MYSQL_UID_GID="999:999"
fi
CONTAINER_UID=$(echo "$MYSQL_UID_GID" | cut -d: -f1)
CONTAINER_GID=$(echo "$MYSQL_UID_GID" | cut -d: -f2)
log_ok "mysql interno: uid=$CONTAINER_UID gid=$CONTAINER_GID"

# In Docker rootless, l'uid del container viene mappato su un uid alto dell'host
# (es. uid 999 container → 100999 host). Formula esatta da subuid:
#   host_uid = sub_uid_base + container_uid
# IMPORTANTE: NON sottrarre 1. /etc/subuid dichiara la BASE del range, e
# uid 0 container → base, uid 1 container → base+1, ..., uid 999 → base+999.
HOST_UID=$CONTAINER_UID
HOST_GID=$CONTAINER_GID
SUB_UID_LINE=$(grep "^$(id -un):" /etc/subuid 2>/dev/null || true)
SUB_GID_LINE=$(grep "^$(id -gn):" /etc/subgid 2>/dev/null || true)
if [ -n "$SUB_UID_LINE" ]; then
    SUB_UID_BASE=$(echo "$SUB_UID_LINE" | cut -d: -f2)
    HOST_UID=$((SUB_UID_BASE + CONTAINER_UID))
    log_ok "Docker rootless rilevato: uid container $CONTAINER_UID → host $HOST_UID"
fi
if [ -n "$SUB_GID_LINE" ]; then
    SUB_GID_BASE=$(echo "$SUB_GID_LINE" | cut -d: -f2)
    HOST_GID=$((SUB_GID_BASE + CONTAINER_GID))
fi

# Inoltre, se App_Data/Database_Data esiste GIÀ con un uid PLAUSIBILE per
# l'host (>= 100000 su rootless, oppure uid utente reale), fidiamoci di quello.
# IMPORTANTE: NON usiamo mai uid < 1000 perché quelli sono uid container-interni
# (es. 999=mysql) e in rootless non hanno equivalente host. Se vediamo 999:999
# significa che un setup precedente ha sbagliato il chown — riapplichiamo
# il calcolo originale (subuid mapping).
if [ -d "App_Data/Database_Data" ] && [ -f "App_Data/Database_Data/ibdata1" ]; then
    EXISTING_UID=$(stat -c '%u' App_Data/Database_Data/ibdata1)
    EXISTING_GID=$(stat -c '%g' App_Data/Database_Data/ibdata1)
    # Solo override se l'uid esistente è "host-plausibile":
    #   - >= 1000 (normale utente Linux)
    #   - oppure 0 (root: caso Docker non-rootless)
    if [ "$EXISTING_UID" -ge 1000 ] || [ "$EXISTING_UID" = "0" ]; then
        if [ "$EXISTING_UID" != "$HOST_UID" ] || [ "$EXISTING_GID" != "$HOST_GID" ]; then
            log_warn "ibdata1 esistente ha uid:gid=$EXISTING_UID:$EXISTING_GID, override del calcolo"
            HOST_UID=$EXISTING_UID
            HOST_GID=$EXISTING_GID
        fi
    else
        log_warn "ibdata1 ha uid=$EXISTING_UID (<1000, non plausibile host). Forzo uid mappato $HOST_UID."
    fi
fi

log_info "UID:GID finale per fix permessi: $HOST_UID:$HOST_GID"

# ============================================================================
# STEP 3: Fix permessi e ownership
# ============================================================================
log_step "3/6  Allineamento permessi App_Data"

# Crea App_Data se non c'è
mkdir -p App_Data

# Sottocartelle che il container deve poter scrivere
for subdir in Database_Data User_Images Sessions; do
    if [ ! -d "App_Data/$subdir" ]; then
        log_info "Creo App_Data/$subdir"
        # Non usiamo mkdir + chown qui: la facciamo creare al container al primo avvio.
        # Eccezione: Sessions e User_Images servono già a tutti i container PHP,
        # quindi le pre-creiamo con l'uid corretto.
        if [ "$subdir" != "Database_Data" ]; then
            mkdir -p "App_Data/$subdir"
            sudo chown "$HOST_UID:$HOST_GID" "App_Data/$subdir" 2>/dev/null || \
                chown "$HOST_UID:$HOST_GID" "App_Data/$subdir" 2>/dev/null || \
                log_warn "Chown su App_Data/$subdir richiede permessi: rilancia con sudo"
        fi
    fi
done

# Se Database_Data ESISTE già, sistemiamo i permessi (gestisce mapping rootless cambiato)
if [ -d "App_Data/Database_Data" ]; then
    log_info "Allineo proprietario di App_Data/Database_Data a $HOST_UID:$HOST_GID"
    sudo chown -R "$HOST_UID:$HOST_GID" App_Data/Database_Data
    # Permessi: tutte le sottocartelle dati MariaDB devono essere drwx------ (0700)
    # per l'owner, ma readable. Il container usa la stessa uid quindi 0700 va bene.
    sudo chmod -R u+rwX App_Data/Database_Data
    log_ok "Database_Data: owner=$HOST_UID:$HOST_GID"
fi

# Allinea anche User_Images e Sessions se esistono
for subdir in User_Images Sessions; do
    if [ -d "App_Data/$subdir" ]; then
        sudo chown -R "$HOST_UID:$HOST_GID" "App_Data/$subdir" 2>/dev/null || true
        log_ok "$subdir: owner=$HOST_UID:$HOST_GID"
    fi
done

# ============================================================================
# STEP 4: Avvio MariaDB e attesa healthy
# ============================================================================
log_step "4/6  Avvio MariaDB"

# Stop solo mysql per ripartire pulito (lascia gli altri)
docker compose stop mysql >/dev/null 2>&1 || true
docker compose rm -f mysql >/dev/null 2>&1 || true

# Pulisci tc.log e aria_log.* (vengono ricreati dal boot, prevengono crash recovery loop)
sudo rm -f App_Data/Database_Data/tc.log 2>/dev/null || true

log_info "Avvio container DATABASE_MySQL..."
docker compose up -d mysql

# Aspetta healthy con timeout
TIMEOUT=120
ELAPSED=0
INTERVAL=3
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
    STATUS=$(docker inspect DATABASE_MySQL --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    case "$STATUS" in
        healthy)
            log_ok "MariaDB healthy dopo ${ELAPSED}s"
            break
            ;;
        unhealthy)
            log_err "MariaDB unhealthy. Ultimi log:"
            docker logs DATABASE_MySQL --tail 30
            exit 1
            ;;
        starting|missing)
            echo -ne "\r  Attendo healthcheck... ${ELAPSED}s/${TIMEOUT}s "
            sleep $INTERVAL
            ELAPSED=$((ELAPSED + INTERVAL))
            ;;
        *)
            echo -ne "\r  Status=$STATUS ${ELAPSED}s "
            sleep $INTERVAL
            ELAPSED=$((ELAPSED + INTERVAL))
            ;;
    esac
done
echo  # newline dopo il loop

if [ "$STATUS" != "healthy" ]; then
    log_err "Timeout attesa healthy. Log MariaDB:"
    docker logs DATABASE_MySQL --tail 50
    exit 1
fi

# ============================================================================
# STEP 5: Avvio resto dello stack
# ============================================================================
log_step "5/6  Avvio resto dei container"

docker compose up -d

# Attendi un attimo che parta tutto
sleep 5

# ============================================================================
# STEP 6: Verifica stato finale
# ============================================================================
log_step "6/6  Stato finale"

docker compose ps

echo
log_info "Status API:"
STATUS_JSON=$(curl -s http://localhost/api/status.php 2>/dev/null || echo "")
if [ -n "$STATUS_JSON" ]; then
    echo "$STATUS_JSON" | (python3 -m json.tool 2>/dev/null || cat)
fi

echo
log_ok "Setup completato!"
log_info ""
log_info "Apri il browser su: ${B}http://localhost${N}"
log_info "Se è il primo avvio, ti apparirà il Setup Wizard per creare l'admin."
log_info ""
log_info "Comandi utili:"
log_info "  Fermare:    docker compose down"
log_info "  Log live:   docker compose logs -f <nome_container>"
log_info "  Stato:      docker compose ps"
