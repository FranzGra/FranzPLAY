# providers/tmdb.py
# ----------------------------------------------------------------------------
# Provider The Movie Database (https://www.themoviedb.org) — API v3.
#
# COPRE: film e serie TV. E' il complemento naturale di ThePornDB per una
# libreria mista: TPDB non conosce i film generalisti e viceversa.
#
# TOKEN: obbligatorio. Si ottiene gratuitamente da
#        https://www.themoviedb.org/settings/api
#        Si accetta sia la "API Key (v3 auth)" sia il "API Read Access Token"
#        (v4, formato JWT che inizia per "eyJ"): il metodo di autenticazione
#        viene scelto automaticamente in base al formato.
#
# IMMAGINE SCELTA: `backdrop_path`, NON `poster_path`.
#   backdrop = 16:9 orizzontale  -> coerente con la UI aspect-video
#   poster   = 2:3 verticale     -> verrebbe tagliato male
# Stessa scelta fatta per TPDB (`background` invece di `posters`).
#
# NOTA SULLA DURATA: l'endpoint di ricerca NON restituisce la durata. Lo
# scoring quindi non puo' usarla e si basa su titolo e anno. E' un limite del
# provider, non del nostro codice: recuperarla richiederebbe una chiamata di
# dettaglio per ogni candidato, cioe' decine di richieste per una sola ricerca.
# ----------------------------------------------------------------------------

import logging
import os

import requests

from .base import ProviderBase

API_BASE = os.environ.get('TMDB_API_BASE', 'https://api.themoviedb.org/3').rstrip('/')
IMAGE_BASE = os.environ.get('TMDB_IMAGE_BASE', 'https://image.tmdb.org/t/p')
# w1280 e' il taglio piu' grande ragionevole per una copertina: oltre si
# scaricano megabyte inutili per una miniatura.
IMAGE_SIZE = os.environ.get('TMDB_IMAGE_SIZE', 'w1280')
HTTP_TIMEOUT = int(os.environ.get('COVERS_HTTP_TIMEOUT', '20'))
USER_AGENT = 'FranzPLAY/1.0 (self-hosted media server)'


class TMDBProvider(ProviderBase):

    name = 'tmdb'
    etichetta = 'The Movie Database'

    # ------------------------------------------------------------------
    def _e_token_v4(self):
        """Il token v4 e' un JWT: inizia per 'eyJ' ed e' lungo."""
        return self.token.startswith('eyJ')

    def _headers(self):
        h = {'Accept': 'application/json', 'User-Agent': USER_AGENT}
        if self.token and self._e_token_v4():
            h['Authorization'] = 'Bearer ' + self.token
        return h

    def _get(self, percorso, params):
        from .tpdb import ProviderAuthError, ProviderRateLimit  # eccezioni condivise

        if not self.token:
            raise ProviderAuthError('The Movie Database richiede un token')

        p = dict(params)
        # Token v3: si passa come query string, non come header.
        if not self._e_token_v4():
            p['api_key'] = self.token

        try:
            r = requests.get(API_BASE + percorso, params=p,
                             headers=self._headers(), timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            raise RuntimeError('errore di rete verso TMDB: %s' % e)

        if r.status_code == 429:
            raise ProviderRateLimit('TMDB ha risposto 429 (rate limit)')
        if r.status_code in (401, 403):
            raise ProviderAuthError('token TMDB assente o non valido')
        if r.status_code != 200:
            raise RuntimeError('TMDB ha risposto HTTP %d' % r.status_code)
        try:
            return r.json()
        except ValueError:
            raise RuntimeError('risposta non JSON da TMDB')

    # ------------------------------------------------------------------
    @staticmethod
    def _url_immagine(percorso_relativo):
        if not percorso_relativo:
            return None
        return '%s/%s%s' % (IMAGE_BASE, IMAGE_SIZE, percorso_relativo)

    @classmethod
    def _normalizza(cls, elemento, tipo):
        """`tipo` in {'movie','tv'}: i due endpoint usano campi diversi."""
        if tipo == 'tv':
            titolo = elemento.get('name') or ''
            data = elemento.get('first_air_date') or ''
        else:
            titolo = elemento.get('title') or ''
            data = elemento.get('release_date') or ''

        # Preferiamo il backdrop (16:9); il poster resta come ripiego.
        immagine = cls._url_immagine(elemento.get('backdrop_path'))
        if not immagine:
            immagine = cls._url_immagine(elemento.get('poster_path'))

        return {
            'id': '%s-%s' % (tipo, elemento.get('id')),
            'title': titolo,
            # TMDB non ha il concetto di "studio" nella ricerca: usiamo il tipo
            # di contenuto, che nella UI e' comunque un'informazione utile.
            'site': 'Film' if tipo == 'movie' else 'Serie TV',
            'date': data[:10] if data else '',
            'duration': 0,          # non disponibile nella ricerca (vedi nota in testa)
            'image_url': immagine,
            'description': elemento.get('overview') or '',
            'performers': [],       # richiederebbe una chiamata /credits per candidato
            'tags': [],
        }

    # ------------------------------------------------------------------
    def search(self, modo, valore, limit=10):
        """
        TMDB non ha un endpoint 'parse': qualunque modo diventa una ricerca
        testuale. Interroghiamo film e serie e uniamo i risultati.
        """
        query = (valore or '').strip()
        if not query:
            return []

        risultati = []
        for tipo, percorso in (('movie', '/search/movie'), ('tv', '/search/tv')):
            try:
                dati = self._get(percorso, {'query': query, 'include_adult': 'false'})
            except Exception:
                # Un endpoint che fallisce non deve far cadere l'altro.
                if tipo == 'movie':
                    raise
                logging.warning('[TMDB] ricerca serie fallita, uso solo i film')
                continue
            for elemento in (dati.get('results') or [])[:limit]:
                normalizzato = self._normalizza(elemento, tipo)
                if normalizzato['id'] and normalizzato['image_url']:
                    risultati.append(normalizzato)

        logging.debug('[TMDB] %r -> %d risultati utili', query, len(risultati))
        return risultati[:limit * 2]

    def test_connessione(self):
        """Diagnostica per il bottone 'Prova' della UI admin."""
        from .tpdb import ProviderAuthError, ProviderRateLimit
        try:
            dati = self._get('/search/movie', {'query': 'matrix'})
        except (ProviderAuthError, ProviderRateLimit) as e:
            return False, str(e)
        except Exception as e:
            return False, str(e)
        totale = dati.get('total_results', '?')
        return True, 'Connessione riuscita (%s risultati sulla query di prova)' % totale
