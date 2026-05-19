# cache_invalidation.py
# ----------------------------------------------------------------------------
# Modulo condiviso per l'invalidazione coerente della cache Redis dai worker
# Python (watcher, worker_metadata, worker_assets, worker_optimizer).
#
# PRINCIPI:
#   - Fail-open: se Redis è giù o redis-py manca, il worker NON si blocca.
#   - Connessioni "use-and-discard": ogni invalidazione apre/chiude la conn.
#     Le invalidazioni sono rare (1 ogni evento filesystem), non vale la pena
#     mantenere un pool persistente con relativo retry logic.
#   - SCAN invece di KEYS per evitare di bloccare Redis su DB grandi.
#
# CHIAVI CACHE GESTITE (speculari a Backend/api/*.php):
#   - categorie_list_v1           → da categorie.php       (lista categorie)
#   - videos_list_*               → da videos.php          (feed Home/Categorie)
#   - impostazioni_globali        → da impostazioni.php    (logo, ecc.)
#   - system_status_v1            → da status.php          (info sistema)
#
# Le sessioni utente e i contatori rate-limit (rate_limit:*) NON vengono mai
# toccati dai worker — sono di pertinenza esclusiva del backend PHP.
# ----------------------------------------------------------------------------

import logging
import os

try:
    import redis as _redis_lib
except ImportError:
    _redis_lib = None

_REDIS_HOST = os.environ.get('REDIS_HOST', 'redis')
_REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD') or None
_REDIS_PORT = int(os.environ.get('REDIS_PORT', '6379'))
_REDIS_TIMEOUT = float(os.environ.get('REDIS_TIMEOUT', '2.0'))


def _connect():
    """Apre una connessione Redis. Ritorna None se non disponibile."""
    if _redis_lib is None:
        return None
    try:
        return _redis_lib.Redis(
            host=_REDIS_HOST, port=_REDIS_PORT, password=_REDIS_PASSWORD,
            socket_connect_timeout=_REDIS_TIMEOUT,
            socket_timeout=_REDIS_TIMEOUT,
            decode_responses=False,  # tratta valori come bytes (compatibile JSON di phpredis)
        )
    except Exception as e:
        logging.warning(f"[CACHE] Connessione Redis fallita (fail-open): {e}")
        return None


def _delete_pattern(r, pattern, count=100):
    """Cancella tutte le chiavi che matchano il pattern. Usa SCAN (non KEYS)."""
    deleted = 0
    cursor = 0
    while True:
        cursor, keys = r.scan(cursor=cursor, match=pattern, count=count)
        if keys:
            deleted += r.delete(*keys)
        if cursor == 0:
            break
    return deleted


def invalidate_videos_and_categories(reason=''):
    """
    Invalidazione standard usata quando cambia QUALSIASI cosa che si vede
    in Home, Categorie page, lista admin: nuovo video, eliminazione, rinomina,
    spostamento, cover modificata.

    Cancella:
      - tutte le `videos_list_*`  (cache di videos.php)
      - `categorie_list_v1`        (cache di categorie.php)
    """
    r = _connect()
    if r is None:
        return
    try:
        deleted_videos = _delete_pattern(r, 'videos_list_*')
        deleted_cat = r.delete('categorie_list_v1') or 0
        total = deleted_videos + deleted_cat
        if total:
            tag = f" ({reason})" if reason else ''
            logging.info(f"[CACHE] Invalidate {deleted_videos} videos_list_* + {deleted_cat} categorie_list_v1{tag}")
    except Exception as e:
        logging.warning(f"[CACHE] Invalidazione fallita (fail-open): {e}")
    finally:
        try:
            r.close()
        except Exception:
            pass


def invalidate_videos_only(reason=''):
    """
    Variante più mirata: invalida SOLO le liste video.
    Usata dal worker_assets quando aggiorna copertina/anteprima
    (non cambia nulla nella lista categorie).
    """
    r = _connect()
    if r is None:
        return
    try:
        deleted = _delete_pattern(r, 'videos_list_*')
        if deleted:
            tag = f" ({reason})" if reason else ''
            logging.info(f"[CACHE] Invalidate {deleted} videos_list_*{tag}")
    except Exception as e:
        logging.warning(f"[CACHE] Invalidazione fallita (fail-open): {e}")
    finally:
        try:
            r.close()
        except Exception:
            pass
