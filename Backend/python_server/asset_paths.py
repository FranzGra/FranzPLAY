# asset_paths.py
# ----------------------------------------------------------------------------
# Modulo CONDIVISO per il calcolo dei percorsi degli asset (copertine/anteprime)
# e per la validazione anti-traversal.
#
# PERCHE' ESISTE:
# La regola "il suffisso della cartella asset si ricava dal NOME DELLA CARTELLA
# SU DISCO, non da Categorie.Nome" era duplicata in worker_assets.py e (in PHP)
# in admin_modules/assets.php. Con l'arrivo di worker_covers.py sarebbe stata
# la terza copia. Stessa filosofia di subtitles_common.py: la logica vive in un
# posto solo, cosi' le implementazioni non possono divergere.
#
# IL VINCOLO (non modificarlo senza aggiornare anche assets.php):
# Categorie.Nome contiene gli spazi originali per la UI ("Freeuse MILF"), ma su
# disco il watcher sanifica con underscore ("Freeuse_MILF"). Usare il Nome
# creerebbe "anteprime_Freeuse MILF" mentre PHP (che deriva dal path) cerca
# "anteprime_Freeuse_MILF" -> due cartelle, asset orfani, link rotti.
#
# CONVENZIONE PATH NEL DB (critica):
# forward slash, SENZA slash iniziale (es. "Cat/copertine_Cat/x.jpg"). Uno slash
# iniziale fa sembrare l'asset "orfano" a watcher.cleanup_orphaned_assets(), che
# lo cancella al riavvio.
# ----------------------------------------------------------------------------

import logging
import os
from pathlib import Path

PATH_TO_MONITOR = os.environ.get('WATCH_DIR', '/percorsoVideo')


def folder_suffix(relative_path, category_name=None):
    """
    Ritorna il suffisso da usare per le cartelle asset (copertine_X/anteprime_X).

    E' il basename della cartella che contiene il video; per i video posati
    nella root di WATCH_DIR (nessuna cartella padre) e' SEMPRE "Generale".

    ⚠️ `category_name` NON viene usato come suffisso, ed e' intenzionale.
    Usarlo faceva divergere Python dal PHP: assets.php e
    cover_provider.coverPercorsoCopertina() per i video in root scrivono
    sempre "copertine_Generale", mentre qui si otteneva
    "copertine_<Categorie.Nome>" — con gli spazi originali del nome categoria.
    Peggio: watcher.cleanup_orphaned_assets() calcola parent_name="Generale"
    per la root e considera "obsoleta" qualsiasi cartella con un altro nome,
    cancellandola con shutil.rmtree(). Il parametro resta nella firma solo per
    compatibilita' con i chiamanti esistenti.
    """
    parent_dir = Path(relative_path).parent
    return parent_dir.name if parent_dir.name else "Generale"


def get_cover_paths(relative_path, category_name=None, ext="jpg"):
    """
    Percorsi della COPERTINA per un video.

    L'estensione e' un parametro perche' worker_covers la deduce dai magic bytes
    dell'immagine scaricata (gli URL del provider mentono: un file servito come
    ".webp" puo' essere un JPEG). worker_assets usa sempre "jpg".

    Ritorna (full_path, db_path).
    """
    p = Path(relative_path)
    suffix = folder_suffix(relative_path, category_name)
    db_path = (p.parent / ("copertine_%s" % suffix) / ("%s.%s" % (p.stem, ext))).as_posix()
    return os.path.join(PATH_TO_MONITOR, db_path), db_path


def get_preview_paths(relative_path, category_name=None):
    """Percorsi dell'ANTEPRIMA per un video. Ritorna (full_path, db_path)."""
    p = Path(relative_path)
    suffix = folder_suffix(relative_path, category_name)
    db_path = (p.parent / ("anteprime_%s" % suffix) / ("%s.mp4" % p.stem)).as_posix()
    return os.path.join(PATH_TO_MONITOR, db_path), db_path


def get_asset_paths(relative_path, category_name=None):
    """
    Firma storica usata da worker_assets.process_missing_assets().
    Ritorna (full_cover, db_cover, full_preview, db_preview).
    """
    full_cover, db_cover = get_cover_paths(relative_path, category_name)
    full_preview, db_preview = get_preview_paths(relative_path, category_name)
    return full_cover, db_cover, full_preview, db_preview


def validate_under_base(full_path, base=None):
    """
    Rifiuta path fuori da WATCH_DIR e symlink (anti path-traversal).
    Stessa semantica di worker_subtitles._validate_under_base.
    """
    base = base or PATH_TO_MONITOR
    try:
        full_real = os.path.realpath(full_path)
        base_real = os.path.realpath(base)
        if not (full_real == base_real or full_real.startswith(base_real + os.sep)):
            logging.warning("[SECURITY] Path fuori base: %s" % full_path)
            return False
        if os.path.islink(full_path):
            logging.warning("[SECURITY] Symlink ignorato: %s" % full_path)
            return False
        return True
    except OSError:
        return False
