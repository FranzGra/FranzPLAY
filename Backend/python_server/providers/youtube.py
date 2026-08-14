# providers/youtube.py
# ----------------------------------------------------------------------------
# Provider YouTube — copertine dei video scaricati da YouTube.
#
# ============================================================================
# CONFORMITA' ALLE POLICY — LEGGERE PRIMA DI MODIFICARE
# ============================================================================
# Le YouTube API Services Developer Policies
# (https://developers.google.com/youtube/terms/developer-policies) consentono
# di conservare i dati ottenuti dall'API per un massimo di 30 giorni, dopo i
# quali vanno "cancellati o aggiornati". NON vietano la conservazione: vietano
# di CONGELARE il dato.
#
# Di conseguenza questo provider salva sempre l'ID del video (`match_id`) e il
# worker ri-scarica periodicamente la miniatura prima della scadenza
# (impostazione `copertine_youtube_rinnovo_giorni`, default 25). E' il
# meccanismo che rende lecita la conservazione locale.
#
# Altre regole rispettate:
#   - la miniatura NON viene modificata (nessun ritaglio, nessuna sovrimpressione)
#   - si conserva l'URL del video per poter attribuire e rimandare a YouTube
#   - la chiave API non sta nel codice ma in Impostazioni: il repository e'
#     pubblico e una chiave committata sarebbe sia una violazione sia un
#     problema di sicurezza
#
# ⚠️ Questa e' una lettura in buona fede delle policy pubblicate, non un parere
#    legale. Se il progetto dovesse essere distribuito come servizio a terzi,
#    la questione va verificata da chi ne ha competenza.
# ============================================================================
#
# DUE STRADE, MOLTO DIVERSE PER COSTO:
#
# 1. ID NEL NOME FILE (costo zero)
#    yt-dlp puo' includere l'ID nel nome ("Titolo [dQw4w9WgXcQ].mp4"). Se c'e',
#    la miniatura si costruisce direttamente: NESSUNA chiamata API, nessuna
#    quota, nessuna chiave. L'ID sopravvive alla sanificazione del watcher, che
#    trasforma le parentesi quadre in underscore ma non tocca i caratteri
#    interni.
#
# 2. RICERCA PER TITOLO (costo alto)
#    Richiede `search.list` della Data API v3: 100 unita' su una quota
#    giornaliera di 10.000, cioe' circa 100 ricerche al giorno. Per confronto
#    `videos.list` costa 1 unita'. Per questo la strada 1 viene sempre provata
#    per prima.
#
# FORMATI MINIATURA (misurati sul campo):
#    maxresdefault 1278x720 16:9  <- quello giusto per la UI aspect-video
#    mqdefault      320x180 16:9  <- ripiego, sempre presente
#    sddefault      640x480 4:3   } scartati: comparirebbero con bande nere
#    hqdefault      480x360 4:3   }
# `maxresdefault` NON esiste per tutti i video (risponde 404): serve il ripiego.
# ----------------------------------------------------------------------------

import logging
import os
import re

import requests

from .base import ProviderBase, build_query

API_BASE = os.environ.get('YOUTUBE_API_BASE', 'https://www.googleapis.com/youtube/v3').rstrip('/')
IMG_BASE = os.environ.get('YOUTUBE_IMG_BASE', 'https://i.ytimg.com/vi')
HTTP_TIMEOUT = int(os.environ.get('COVERS_HTTP_TIMEOUT', '20'))
USER_AGENT = 'FranzPLAY/1.0 (self-hosted media server)'

# Costo in unita' di quota di una chiamata search.list (documentato da Google).
COSTO_RICERCA = 100

# Un ID YouTube e' esattamente 11 caratteri fra lettere, cifre, '-' e '_'.
# Lo cerchiamo delimitato, per non catturare pezzi a caso di un nome lungo.
_RE_ID = re.compile(r'(?:^|[^0-9A-Za-z_-])([0-9A-Za-z_-]{11})(?:$|[^0-9A-Za-z_-])')

# Formati 16:9, in ordine di preferenza. Gli altri hanno bande nere.
FORMATI_16_9 = ['maxresdefault', 'mqdefault']


def estrai_id_da_nome(nome):
    """
    Cerca un ID YouTube nel nome del file. Ritorna l'ID o None.

    ⚠️ IL CASO DIFFICILE E' QUELLO SANIFICATO.
    yt-dlp scrive "Titolo [dQw4w9WgXcQ].mp4", ma watcher.sanitize_path
    trasforma le parentesi quadre in underscore -> "Titolo__dQw4w9WgXcQ_.mp4".
    L'underscore diventa cosi' sia delimitatore sia carattere valido DENTRO
    l'ID, e la distinzione a colpo sicuro non e' possibile.

    Percio' qui siamo DELIBERATAMENTE PERMISSIVI e restituiamo un candidato
    plausibile: la verifica vera la fa `miglior_miniatura()`, che interroga
    i.ytimg.com e ottiene 404 se l'ID non esiste. Un falso positivo costa una
    richiesta HEAD e si auto-corregge; un falso negativo costerebbe invece 100
    unita' di quota per una ricerca per titolo evitabile.

    Il rischio che 11 caratteri casuali coincidano con un video reale e'
    trascurabile: lo spazio degli ID e' 64^11.
    """
    if not nome:
        return None

    # Si lavora sullo STEM: l'estensione falserebbe gli ancoraggi di fine riga.
    stem = re.sub(r'\.[A-Za-z0-9]{2,4}$', '', nome)

    # 1) Forma esplicita, quando le parentesi sono sopravvissute.
    for pattern in (r'\[([0-9A-Za-z_-]{11})\]', r'\(([0-9A-Za-z_-]{11})\)'):
        m = re.search(pattern, stem)
        if m:
            return m.group(1)

    # 2) Forma sanificata: l'ID sta in coda, isolato da uno o piu' underscore
    #    ed eventualmente seguito da underscore residui.
    m = re.search(r'_([0-9A-Za-z_-]{11})_*$', stem)
    if m:
        return m.group(1)

    # 3) Ultimo ripiego: gli 11 caratteri finali dello stem, se il nome e'
    #    abbastanza lungo da rendere improbabile che siano l'intero titolo.
    if len(stem) > 15:
        coda = stem[-11:]
        if re.fullmatch(r'[0-9A-Za-z_-]{11}', coda):
            return coda
    return None


def url_miniatura(video_id, formato='maxresdefault'):
    return '%s/%s/%s.jpg' % (IMG_BASE, video_id, formato)


def url_video(video_id):
    return 'https://www.youtube.com/watch?v=%s' % video_id


def miglior_miniatura(video_id, timeout=HTTP_TIMEOUT):
    """
    Ritorna l'URL della miniatura 16:9 di qualita' piu' alta effettivamente
    esistente. `maxresdefault` manca su parecchi video (404), quindi va
    verificato con una HEAD prima di proporlo.

    NB: queste sono richieste a i.ytimg.com, non alla Data API: non consumano
    quota e non richiedono chiave.
    """
    for formato in FORMATI_16_9:
        url = url_miniatura(video_id, formato)
        try:
            r = requests.head(url, timeout=timeout,
                              headers={'User-Agent': USER_AGENT},
                              allow_redirects=True)
            if r.status_code == 200:
                return url
        except requests.RequestException:
            continue
    return None


class YouTubeProvider(ProviderBase):

    name = 'youtube'
    etichetta = 'YouTube'

    # ------------------------------------------------------------------
    def _get(self, percorso, params):
        from .tpdb import ProviderAuthError, ProviderRateLimit

        if not self.token:
            raise ProviderAuthError(
                'la ricerca per titolo su YouTube richiede una chiave API')

        p = dict(params)
        p['key'] = self.token
        try:
            r = requests.get(API_BASE + percorso, params=p,
                             headers={'Accept': 'application/json',
                                      'User-Agent': USER_AGENT},
                             timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            raise RuntimeError('errore di rete verso YouTube: %s' % e)

        if r.status_code == 403:
            # 403 copre sia quota esaurita sia chiave non valida: il dettaglio
            # sta nel corpo, ed e' utile mostrarlo tale e quale all'admin.
            testo = ''
            try:
                testo = (r.json().get('error', {}).get('message') or '')[:200]
            except ValueError:
                pass
            if 'quota' in testo.lower():
                raise ProviderRateLimit('quota giornaliera YouTube esaurita: %s' % testo)
            raise ProviderAuthError('chiave YouTube rifiutata: %s' % testo)
        if r.status_code == 400:
            raise ProviderAuthError('richiesta YouTube non valida (chiave errata?)')
        if r.status_code != 200:
            raise RuntimeError('YouTube ha risposto HTTP %d' % r.status_code)
        try:
            return r.json()
        except ValueError:
            raise RuntimeError('risposta non JSON da YouTube')

    # ------------------------------------------------------------------
    @staticmethod
    def _normalizza(video_id, titolo, canale, data, descrizione=''):
        return {
            'id': video_id,
            'title': titolo or '',
            'site': canale or 'YouTube',
            'date': (data or '')[:10],
            'duration': 0,        # non presente in search.list
            'image_url': url_miniatura(video_id, 'maxresdefault'),
            'description': descrizione or '',
            'performers': [],
            'tags': [],
            # Serve all'attribuzione e al rinnovo periodico della miniatura.
            'source_url': url_video(video_id),
        }

    def search(self, modo, valore, limit=10):
        """
        Ricerca per titolo via Data API. Costa COSTO_RICERCA unita' di quota.
        Le miniature di search.list arrivano al massimo in 'high' (480x360,
        4:3): costruiamo noi l'URL 16:9 partendo dall'ID.
        """
        query = (valore or '').strip()
        if not query:
            return []

        dati = self._get('/search', {
            'part': 'snippet',
            'type': 'video',
            'q': query,
            'maxResults': min(limit, 25),
        })

        risultati = []
        for item in (dati.get('items') or []):
            vid = ((item.get('id') or {}).get('videoId') or '').strip()
            if not vid:
                continue
            sn = item.get('snippet') or {}
            risultati.append(self._normalizza(
                vid, sn.get('title'), sn.get('channelTitle'),
                sn.get('publishedAt'), sn.get('description')))
        logging.debug('[YouTube] %r -> %d risultati', query, len(risultati))
        return risultati

    # ------------------------------------------------------------------
    def cerca_candidati(self, relative_path, titolo_db=None, durata_sec=None,
                        limit=10, soglia_stop=80, on_call=None):
        """
        Sovrascrive il flusso standard per anteporre la STRADA A COSTO ZERO.

        Se il nome file contiene un ID YouTube, la copertina si ottiene senza
        toccare la Data API: nessuna quota consumata, nessuna chiave richiesta,
        e nessun dato ottenuto tramite API (quindi fuori dal perimetro delle
        policy sulla conservazione).
        """
        from .base import score_match

        query = build_query(relative_path, titolo_db, provider=self.name)
        nome_file = os.path.basename(relative_path or '')
        video_id = estrai_id_da_nome(nome_file)

        if video_id:
            url = miglior_miniatura(video_id)
            if url:
                candidato = self._normalizza(video_id, titolo_db or query['nome'],
                                             'YouTube', '')
                candidato['image_url'] = url
                candidato['score'] = 100      # l'ID e' un'identificazione esatta
                candidato['via'] = 'id_nel_nome'
                candidato['query'] = video_id
                logging.info("[YouTube] ID '%s' trovato nel nome file: nessuna "
                             "chiamata API necessaria.", video_id)
                return query, [candidato]
            logging.info("[YouTube] ID '%s' nel nome ma nessuna miniatura 16:9 "
                         "disponibile: passo alla ricerca per titolo.", video_id)

        # Nessun ID utilizzabile: ricerca per titolo (consuma quota).
        if not self.token:
            return query, []

        if on_call is not None:
            on_call()
        candidati = []
        for c in self.search('q', query['nome'], limit=limit):
            c['score'] = score_match(c, query, durata_sec)
            c['via'] = 'ricerca_api'
            c['query'] = query['nome']
            candidati.append(c)
        candidati.sort(key=lambda x: x['score'], reverse=True)
        return query, candidati

    # ------------------------------------------------------------------
    def test_connessione(self):
        from .tpdb import ProviderAuthError, ProviderRateLimit
        if not self.token:
            return True, ("Nessuna chiave: funzionano solo i video con l'ID nel "
                          "nome del file (a costo zero). Per la ricerca per "
                          "titolo serve una chiave API.")
        try:
            dati = self._get('/search', {'part': 'snippet', 'type': 'video',
                                         'q': 'test', 'maxResults': 1})
        except (ProviderAuthError, ProviderRateLimit) as e:
            return False, str(e)
        except Exception as e:
            return False, str(e)
        n = len(dati.get('items') or [])
        return True, ("Connessione riuscita (%d risultato di prova). Attenzione: "
                      "ogni ricerca costa %d unita' sulle 10.000 giornaliere, "
                      "cioe' circa 100 ricerche al giorno." % (n, COSTO_RICERCA))
