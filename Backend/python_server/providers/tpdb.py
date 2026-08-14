# providers/tpdb.py
# ----------------------------------------------------------------------------
# Provider ThePornDB (https://theporndb.net) — API https://api.theporndb.net
#
# COMPORTAMENTO VERIFICATO SUL CAMPO (non modificare senza rifare i test):
#
# 1. AUTENTICAZIONE
#    GET /scenes?q=...     -> funziona ANCHE senza token (200)
#    GET /scenes/{uuid}    -> 401 senza token
#    Quindi la ricerca copertine funziona anche a token vuoto; il token serve
#    per il dettaglio (utile in Fase 2). Non trattare il token come obbligatorio.
#
# 2. `parse=` VUOLE IL FORMATO `sito.data.nome` (come fa il client ufficiale namer)
#    parse=Tushy.21.05.02.Emily.Willis.XXX.1080p     -> 0 risultati
#    parse=fit18.2018-12-13.Emily Willis Initial Casting -> match esatto
#    Col nome file grezzo NON funziona: va sempre passato ricomposto (build_query).
#
# 3. `parse=` PUO' RESTITUIRE UN SINGOLO RISULTATO SICURO E SBAGLIATO
#    parse=Blacked - Sofia Lee -> 1 risultato, una scena "Nubile Films" senza
#    alcuna relazione. E' il motivo per cui lo scoring lo calcoliamo noi e per
#    cui il default e' la conferma manuale.
#
# 4. IMMAGINE DA USARE: `background`, NON `posters`
#    posters    = 800x1200 VERTICALE (2:3)
#    background = 1000x562 ORIZZONTALE (16:9 esatto)
#    La UI di FranzPLAY (VideoCard, AdminAssetSlot) e' aspect-video: un poster
#    verticale verrebbe tagliato male.
#
# 5. L'ESTENSIONE NELL'URL MENTE
#    .../bg-....webp restituisce Content-Type: image/jpeg e magic bytes JPEG.
#    Per questo image_fetch deduce l'estensione dal contenuto.
#
# 6. description / performers / tags ARRIVANO GIA' NELLA RICERCA
#    Non serve chiamare il dettaglio: la Fase 2 (attrici/attori, descrizione)
#    puo' usare questi stessi dati. Li normalizziamo gia' adesso.
# ----------------------------------------------------------------------------

import logging
import os

import requests

from .base import ProviderBase

API_BASE = os.environ.get('TPDB_API_BASE', 'https://api.theporndb.net').rstrip('/')
HTTP_TIMEOUT = int(os.environ.get('COVERS_HTTP_TIMEOUT', '20'))
USER_AGENT = 'FranzPLAY/1.0 (self-hosted media server)'


class ProviderRateLimit(Exception):
    """Il provider ci sta limitando (429/503): serve un cooldown, non un retry."""
    pass


class ProviderAuthError(Exception):
    """Token assente o non valido dove invece serve."""
    pass


class TPDBProvider(ProviderBase):

    name = 'tpdb'
    etichetta = 'ThePornDB'

    # ------------------------------------------------------------------
    def _headers(self):
        h = {'Accept': 'application/json', 'User-Agent': USER_AGENT}
        if self.token:
            h['Authorization'] = 'Bearer ' + self.token
        return h

    def _get(self, percorso, params):
        try:
            r = requests.get(API_BASE + percorso, params=params,
                             headers=self._headers(), timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            raise RuntimeError('errore di rete verso ThePornDB: %s' % e)

        if r.status_code in (429, 503):
            raise ProviderRateLimit('ThePornDB ha risposto %d (rate limit)' % r.status_code)
        if r.status_code == 401:
            raise ProviderAuthError('token ThePornDB assente o non valido')
        if r.status_code != 200:
            raise RuntimeError('ThePornDB ha risposto HTTP %d' % r.status_code)
        try:
            return r.json()
        except ValueError:
            raise RuntimeError('risposta non JSON da ThePornDB')

    # ------------------------------------------------------------------
    @staticmethod
    def _scegli_immagine(scena):
        """
        Catena di fallback per la copertina.
        `background` per primo: e' l'unico 16:9, quello che serve alla UI.
        """
        background = scena.get('background') or {}
        for chiave in ('large', 'full', 'medium'):
            if background.get(chiave):
                return background[chiave]
        if scena.get('image'):
            return scena['image']
        posters = scena.get('posters') or {}
        for chiave in ('large', 'full', 'medium'):
            if posters.get(chiave):
                return posters[chiave]
        if scena.get('poster'):
            return scena['poster']
        return None

    @staticmethod
    def _normalizza(scena):
        sito = scena.get('site') or {}
        performers = []
        for p in (scena.get('performers') or []):
            if p.get('name'):
                performers.append(p['name'])
        tags = []
        for t in (scena.get('tags') or []):
            if t.get('name'):
                tags.append(t['name'])
        durata = scena.get('duration') or 0
        try:
            durata = int(durata)
        except (TypeError, ValueError):
            durata = 0
        return {
            'id': scena.get('id') or '',
            'title': scena.get('title') or '',
            'site': sito.get('name') or '',
            'date': (scena.get('date') or '')[:10],
            'duration': durata,
            'image_url': TPDBProvider._scegli_immagine(scena),
            # Campi gia' pronti per la Fase 2 (descrizione, attrici/attori, tag).
            'description': scena.get('description') or '',
            'performers': performers,
            'tags': tags,
        }

    # ------------------------------------------------------------------
    def search(self, modo, valore, limit=10):
        """`modo` in {'parse','q'}. Ritorna una lista di candidati normalizzati."""
        if modo not in ('parse', 'q'):
            raise ValueError("modo di ricerca non supportato: %r" % modo)
        dati = self._get('/scenes', {modo: valore, 'limit': limit})
        scene = dati.get('data') or []
        risultati = []
        for scena in scene:
            normalizzata = self._normalizza(scena)
            # Senza immagine il candidato e' inutile per il nostro scopo.
            if normalizzata['id'] and normalizzata['image_url']:
                risultati.append(normalizzata)
        logging.debug('[TPDB] %s=%r -> %d risultati utili', modo, valore, len(risultati))
        return risultati

    def test_connessione(self):
        """
        Diagnostica per il bottone "Testa connessione" della UI admin.
        Ritorna (ok: bool, messaggio: str).
        """
        try:
            dati = self._get('/scenes', {'q': 'test', 'limit': 1})
        except ProviderAuthError as e:
            return False, str(e)
        except ProviderRateLimit as e:
            return False, str(e)
        except Exception as e:
            return False, str(e)
        totale = (dati.get('meta') or {}).get('total')
        if self.token:
            return True, 'Connessione riuscita (token attivo, %s scene indicizzate)' % totale
        return True, 'Connessione riuscita SENZA token: la ricerca funziona, ' \
                     'ma il dettaglio scena richiede un token'
