# subtitles_common.py
# ============================================================================
# Logica CONDIVISA per i sottotitoli manuali (file .vtt/.srt messi a mano nel
# filesystem). Usata sia dal watcher (rilevamento in tempo reale, un file per
# evento) sia dal worker_subtitles (scansione bulk periodica di fallback).
#
# Centralizzando qui le convenzioni (estensioni, parsing lingua dal nome,
# conversione SRT->VTT, INSERT nella tabella Sottotitoli) evitiamo che watcher
# e worker divergano nel tempo.
# ============================================================================

import os
import re
import logging
from pathlib import Path

# Estensioni riconosciute per i sottotitoli messi a mano.
SUB_EXTENSIONS = ('.vtt', '.srt')

# Lingua assegnata quando il nome file non contiene un codice (es. "video.vtt").
MANUAL_DEFAULT_LANG = (os.environ.get('SUBTITLES_MANUAL_DEFAULT_LANG', 'it') or 'it').lower()


def srt_to_vtt(srt_text):
    """Converte il testo di un .srt in WebVTT (timestamp con '.' e header WEBVTT)."""
    text = srt_text.lstrip('﻿')
    # SRT usa la virgola per i millisecondi: 00:00:01,000 -> 00:00:01.000
    text = re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})', r'\1.\2', text)
    return "WEBVTT\n\n" + text.strip() + "\n"


def validate_under_base(full_path, base):
    """Rifiuta path fuori da `base` e symlink (anti traversal)."""
    try:
        full_real = os.path.realpath(full_path)
        base_real = os.path.realpath(base)
        if not (full_real == base_real or full_real.startswith(base_real + os.sep)):
            return False
        if os.path.islink(full_path):
            return False
        return True
    except OSError:
        return False


def lang_from_name(name, stem):
    """
    Ricava il codice lingua dal nome file (senza estensione) dato lo stem del
    video. Esempi (stem='video'): 'video.en' -> 'en', 'video.en.forced' -> 'en',
    'video' -> MANUAL_DEFAULT_LANG.
    """
    suffix = name[len(stem):].lstrip('.')               # 'en' | '' | 'en.forced'
    return (suffix.split('.')[0].lower() if suffix else MANUAL_DEFAULT_LANG) or MANUAL_DEFAULT_LANG


def find_video_for_subtitle(conn, base, full_src):
    """
    Dato il path assoluto di un file sottotitolo, individua il video di
    riferimento. Il file puo' stare nella cartella del video o in
    sottotitoli_<categoria> (in entrambi i casi il video sta nella cartella
    "padre"). Ritorna (video_stem, video_id) oppure None.
    """
    root = os.path.dirname(full_src)
    bname = os.path.basename(root)
    video_dir = os.path.dirname(root) if bname.startswith('sottotitoli_') else root

    rel_parent = os.path.relpath(video_dir, base).replace('\\', '/')
    rel_parent = '' if rel_parent == '.' else rel_parent

    fname = os.path.basename(full_src)
    name = fname[:-4]  # .vtt/.srt hanno entrambe 4 caratteri

    like = (rel_parent + '/%') if rel_parent else '%'
    candidates = []
    with conn.cursor(dictionary=True) as cur:
        cur.execute("SELECT id, percorso_file FROM Video WHERE percorso_file LIKE %s", (like,))
        for r in cur.fetchall():
            p = Path(r['percorso_file'])
            par = p.parent.as_posix()
            par = '' if par == '.' else par
            if par != rel_parent:
                continue  # LIKE puo' pescare sottocartelle: teniamo solo il parent esatto
            candidates.append((p.stem, r['id']))

    # Match col video il cui stem combacia (preferisci lo stem piu' lungo).
    matched = None
    for stem, vid in candidates:
        if name == stem or name.startswith(stem + '.'):
            if matched is None or len(stem) > len(matched[0]):
                matched = (stem, vid)
    return matched


def register_subtitle_row(conn, video_id, lang, db_rel, override=True):
    """
    Inserisce/aggiorna la riga Sottotitoli per un sottotitolo manuale.

    override=True  (watcher, evento real-time): l'utente ha appena messo/cambiato
                   il file -> il manuale VINCE: aggiorna percorso, marca
                   'completato'/'manuale' e azzera eventuali errori/lock di una
                   generazione automatica fallita.
    override=False (worker, scansione bulk di fallback): riempie SOLO le lingue
                   mancanti, senza toccare righe gia' presenti (evita di
                   re-invalidare la cache a ogni scansione).

    NON committa: lascia il commit al chiamante (il worker e' in autocommit, il
    watcher committa esplicitamente). Ritorna True se ha modificato il DB.
    """
    with conn.cursor() as cur:
        if override:
            cur.execute(
                "INSERT INTO Sottotitoli "
                "(id_Video, lingua, lingua_origine, tipo, percorso_file, stato, modello_usato, generato_at) "
                "VALUES (%s, %s, %s, 'trascrizione', %s, 'completato', 'manuale', NOW()) "
                "ON DUPLICATE KEY UPDATE "
                "  percorso_file = VALUES(percorso_file), tipo = 'trascrizione', "
                "  stato = 'completato', modello_usato = 'manuale', generato_at = NOW(), "
                "  errore_msg = NULL, locked_at = NULL",
                (video_id, lang, lang, db_rel)
            )
        else:
            cur.execute(
                "INSERT INTO Sottotitoli "
                "(id_Video, lingua, lingua_origine, tipo, percorso_file, stato, modello_usato, generato_at) "
                "VALUES (%s, %s, %s, 'trascrizione', %s, 'completato', 'manuale', NOW()) "
                "ON DUPLICATE KEY UPDATE id = id",
                (video_id, lang, lang, db_rel)
            )
        return cur.rowcount > 0


def _materialize_vtt(full_src, base, log):
    """
    Restituisce (db_rel) del .vtt da registrare. Se il file e' un .srt lo
    converte in .vtt accanto all'originale. Ritorna None su errore.
    """
    fname = os.path.basename(full_src)
    name, ext = fname[:-4], fname.lower()[-4:]
    if ext == '.srt':
        full_vtt = os.path.join(os.path.dirname(full_src), f"{name}.vtt")
        try:
            with open(full_src, 'r', encoding='utf-8', errors='replace') as fh:
                srt_text = fh.read()
            with open(full_vtt, 'w', encoding='utf-8') as fh:
                fh.write(srt_to_vtt(srt_text))
        except Exception as e:
            log.warning(f"[Subs] Conversione SRT fallita {full_src}: {e}")
            return None
        target = full_vtt
    else:
        target = full_src
    return os.path.relpath(target, base).replace('\\', '/').lstrip('/')


def import_subtitle_file(conn, full_src, base, log=logging, override=True):
    """
    Importa UN singolo file sottotitolo (path assoluto). Pensata per il watcher:
    valida il path, trova il video, ricava la lingua, converte l'eventuale .srt e
    registra la riga Sottotitoli. NON committa.

    Ritorna (video_id, lang, db_rel) se ha modificato il DB, altrimenti None.
    """
    if not full_src.lower().endswith(SUB_EXTENSIONS):
        return None
    if not validate_under_base(full_src, base) or not os.path.isfile(full_src):
        return None

    matched = find_video_for_subtitle(conn, base, full_src)
    if not matched:
        return None
    stem, vid = matched

    name = os.path.basename(full_src)[:-4]
    lang = lang_from_name(name, stem)

    db_rel = _materialize_vtt(full_src, base, log)
    if db_rel is None:
        return None

    if register_subtitle_row(conn, vid, lang, db_rel, override=override):
        return (vid, lang, db_rel)
    return None


def remove_subtitle_row(conn, db_rel):
    """Rimuove la riga Sottotitoli che punta a `db_rel`. NON committa. True se rimossa."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM Sottotitoli WHERE percorso_file = %s", (db_rel,))
        return cur.rowcount > 0
