# providers/base.py
# ----------------------------------------------------------------------------
# Contratto comune dei provider + logica CONDIVISA di costruzione query e
# scoring, indipendente dal provider concreto.
#
# FORMATO NORMALIZZATO (l'unico che worker/PHP conoscono):
#   {
#     'id': str,            # id univoco sul provider
#     'title': str,
#     'site': str,          # studio / rete
#     'date': str,          # YYYY-MM-DD ('' se ignota)
#     'duration': int,      # secondi (0 se ignota)
#     'image_url': str,     # URL dell'immagine da usare come copertina
#     'description': str,   # gia' popolato: pronto per la Fase 2
#     'performers': [str],  # gia' popolato: pronto per la Fase 2
#     'tags': [str],        # gia' popolato: pronto per la Fase 2
#   }
# ----------------------------------------------------------------------------

import difflib
import re
from pathlib import Path

# Token tecnici da rimuovere dal nome file: sono rumore di release che fa
# crollare il match testuale.
NOISE_TOKENS = set([
    'xxx', 'webdl', 'web', 'dl', 'bluray', 'brrip', 'dvdrip', 'hdrip', 'webrip',
    'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'aac', 'ac3', 'dts', 'opus',
    '1080p', '2160p', '720p', '480p', '360p', '4k', 'uhd', 'sd', 'hd', 'fullhd',
    'internal', 'proper', 'repack', 'multi', 'ita', 'eng', 'sub', 'subs',
    'mp4', 'mkv', 'avi', 'wmv', 'mov',
])

# Pattern data. I separatori sono gia' stati normalizzati a spazio da _desanitize.
_DATE_PATTERNS = [
    (re.compile(r'\b(20\d{2})[ ._-]?(\d{2})[ ._-]?(\d{2})\b'), 'ymd'),
    (re.compile(r'\b(\d{2})[ ._-](\d{2})[ ._-](20\d{2})\b'), 'dmy'),
    (re.compile(r'\b(\d{2})[ ._-](\d{2})[ ._-](\d{2})\b'), 'ymd_corto'),
]


def desanitize(testo):
    """
    Inverte (approssimativamente) la sanificazione del watcher.

    watcher.sanitize_path sostituisce `[^a-zA-Z0-9._-]` con `_`, quindi il nome
    su disco ha underscore dove c'erano spazi/accenti/apostrofi. Senza questo
    passaggio il match sul provider crolla: verificato sul campo.
    """
    if not testo:
        return ''
    t = testo.replace('_', ' ').replace('.', ' ').replace('-', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def estrai_data(testo):
    """Estrae una data ISO dal testo. Ritorna (data|None, testo_senza_data)."""
    for pattern, tipo in _DATE_PATTERNS:
        m = pattern.search(testo)
        if not m:
            continue
        a, b, c = m.group(1), m.group(2), m.group(3)
        try:
            if tipo == 'ymd':
                anno, mese, giorno = int(a), int(b), int(c)
            elif tipo == 'dmy':
                giorno, mese, anno = int(a), int(b), int(c)
            else:
                anno, mese, giorno = 2000 + int(a), int(b), int(c)
            if not (1 <= mese <= 12 and 1 <= giorno <= 31):
                continue
            iso = '%04d-%02d-%02d' % (anno, mese, giorno)
        except ValueError:
            continue
        ripulito = (testo[:m.start()] + ' ' + testo[m.end():]).strip()
        return iso, re.sub(r'\s+', ' ', ripulito)
    return None, testo


def rimuovi_rumore(testo):
    """Toglie gruppi tra parentesi e token tecnici di release."""
    t = re.sub(r'[\[(][^\])]*[\])]', ' ', testo)
    tenute = []
    for parola in t.split():
        if parola.lower().strip('-_.') in NOISE_TOKENS:
            continue
        tenute.append(parola)
    return re.sub(r'\s+', ' ', ' '.join(tenute)).strip()


def build_query(relative_path, titolo_db=None, provider='tpdb'):
    """
    Scompone il path del video in (site, data, nome) e produce i tentativi.

    In FranzPLAY la CARTELLA CATEGORIA coincide spesso con lo studio
    (es. "Blacked/scena.mp4"), quindi la usiamo come componente `site`.
    Verificato sul campo che TPDB con `parse=sito.data.nome` da' match esatti
    (score 100), mentre col nome file grezzo non trova nulla.

    Ritorna {'site', 'data', 'nome', 'tentativi': [(modo, valore), ...]}.
    """
    p = Path(relative_path)
    cartella = p.parent.name if p.parent.name not in ('.', '') else ''

    nome_grezzo = desanitize(p.stem)
    data, nome_senza_data = estrai_data(nome_grezzo)
    nome = rimuovi_rumore(nome_senza_data)

    site = desanitize(cartella)

    # ⚠️ RIMOZIONE DEL PREFISSO: SOLO PER ThePornDB.
    # Su TPDB la cartella e' lo STUDIO e il nome file spesso lo ripete:
    # "Blacked/Blacked Sofia Lee" -> cercare "Blacked.Blacked Sofia Lee"
    # peggiora il match, quindi si toglie il duplicato.
    #
    # Su YouTube e TMDB la cartella e' una semplice CATEGORIA e il titolo va
    # cercato INTERO: da "Forza_Horizon_6/Forza_Horizon_6_Gameplay_impressionante"
    # togliere il prefisso lascerebbe "Gameplay impressionante", che non
    # corrisponde ad alcun video reale.
    if provider == 'tpdb' and site and nome.lower().startswith(site.lower()):
        nome = nome[len(site):].strip(' -.')

    if not nome and titolo_db:
        nome = rimuovi_rumore(desanitize(titolo_db))

    tentativi = []
    if site and data and nome:
        tentativi.append(('parse', '%s.%s.%s' % (site, data, nome)))
    if site and nome:
        tentativi.append(('parse', '%s.%s' % (site, nome)))
    if data and nome:
        tentativi.append(('parse', '%s.%s' % (data, nome)))
    if nome:
        tentativi.append(('parse', nome))
        tentativi.append(('q', nome))

    return {'site': site, 'data': data, 'nome': nome, 'tentativi': tentativi}


def _somiglianza(a, b):
    return difflib.SequenceMatcher(None, (a or '').lower(), (b or '').lower()).ratio()


def score_match(candidato, query, durata_sec=None):
    """
    Confidenza 0-100 CALCOLATA DA NOI: l'API non ne fornisce una, e restituisce
    risultati sbagliati con la stessa apparente sicurezza di quelli giusti
    (verificato: `parse=Blacked - Sofia Lee` ritorna una scena senza relazione).

    Pesi ispirati a namer (il client ufficiale): sito e data valgono molto,
    il titolo e' fuzzy.

    Taratura misurata sui casi reali:
      match corretto con sito+data  -> 100
      match corretto con solo sito  ->  94
      stessa performer, altra scena ->  60-70   (sotto la soglia di default 75)
      video non pertinente          ->  nessun risultato
    """
    punti = _somiglianza(query.get('nome'), candidato.get('title')) * 100.0 * 0.70

    site_q = (query.get('site') or '').replace(' ', '')
    site_c = (candidato.get('site') or '').replace(' ', '')
    if site_q and site_c:
        s = _somiglianza(site_q, site_c)
        if s > 0.85:
            punti += 20.0
        elif s > 0.60:
            punti += 10.0

    data_q = query.get('data')
    data_c = (candidato.get('date') or '')[:10]
    if data_q and data_c:
        if data_q == data_c:
            punti += 10.0
        else:
            punti -= 10.0

    durata_c = candidato.get('duration') or 0
    if durata_sec and durata_c:
        try:
            scarto = abs(float(durata_sec) - float(durata_c)) / float(durata_sec)
            if scarto <= 0.05:
                punti += 5.0
            elif scarto > 0.25:
                punti -= 10.0
        except (ValueError, ZeroDivisionError):
            pass

    return max(0, min(100, int(round(punti))))


class ProviderBase(object):
    """Contratto minimo. Vedi tpdb.py per l'implementazione di riferimento."""

    name = 'base'
    etichetta = 'Provider'

    def __init__(self, token=None):
        self.token = (token or '').strip()

    def search(self, modo, valore, limit=10):
        """Esegue UNA chiamata. `modo` in {'parse','q'}. Ritorna lista normalizzata."""
        raise NotImplementedError

    def cerca_candidati(self, relative_path, titolo_db=None, durata_sec=None,
                        limit=10, soglia_stop=80, on_call=None):
        """
        Esegue i tentativi in ordine finche' non trova un match forte.
        `on_call` (opzionale) e' chiamato prima di ogni richiesta: serve al
        worker per applicare pausa tra richieste e quota giornaliera.

        Ritorna (query, [candidati ordinati per score desc]).
        """
        query = build_query(relative_path, titolo_db, provider=self.name)
        visti = {}
        for modo, valore in query['tentativi']:
            if on_call is not None:
                on_call()
            try:
                risultati = self.search(modo, valore, limit=limit)
            except Exception:
                raise
            for candidato in risultati:
                cid = candidato.get('id')
                if not cid or cid in visti:
                    continue
                candidato['score'] = score_match(candidato, query, durata_sec)
                candidato['via'] = modo
                candidato['query'] = valore
                visti[cid] = candidato
            if visti and max(c['score'] for c in visti.values()) >= soglia_stop:
                break  # match forte: inutile bruciare altre chiamate

        ordinati = sorted(visti.values(), key=lambda c: c['score'], reverse=True)
        return query, ordinati
