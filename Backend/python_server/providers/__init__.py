# providers/__init__.py
# ----------------------------------------------------------------------------
# Registro dei provider di metadati online.
#
# AGGIUNGERE UN PROVIDER:
#   1. creare providers/<nome>.py con una classe che estende ProviderBase
#   2. registrarlo in PROVIDERS e descriverlo in PROVIDER_META qui sotto
#   3. replicare la stessa voce in Backend/api/cover_provider.php (catalogo PHP)
# Nient'altro: worker e backend lavorano solo sul formato normalizzato di base.py.
#
# ⚠️ PROVIDER_META deve restare allineato al catalogo PHP: e' la UI admin a
#    leggerlo per mostrare l'elenco dei database configurabili.
# ----------------------------------------------------------------------------

from .tpdb import TPDBProvider
from .tmdb import TMDBProvider
from .youtube import YouTubeProvider

PROVIDERS = {
    'tpdb': TPDBProvider,
    'tmdb': TMDBProvider,
    'youtube': YouTubeProvider,
}

# Metadati per la UI e per le decisioni del worker.
#   token_obbligatorio : se True e il token manca, il provider viene saltato
#   contenuti          : a cosa serve, mostrato nella UI
PROVIDER_META = {
    'tpdb': {
        'etichetta': 'ThePornDB',
        'contenuti': 'Contenuti per adulti',
        'token_obbligatorio': False,   # la ricerca funziona anche senza (verificato)
        'url_token': 'https://theporndb.net/user/api-tokens',
    },
    'tmdb': {
        'etichetta': 'The Movie Database',
        'contenuti': 'Film e serie TV',
        'token_obbligatorio': True,
        'url_token': 'https://www.themoviedb.org/settings/api',
    },
    'youtube': {
        'etichetta': 'YouTube',
        'contenuti': 'Video scaricati da YouTube',
        # Facoltativo: senza chiave restano coperti tutti i file che hanno
        # l'ID nel nome, a costo zero e fuori dal perimetro della Data API.
        'token_obbligatorio': False,
        'url_token': 'https://console.cloud.google.com/apis/credentials',
        # I dati ottenuti via API vanno aggiornati entro 30 giorni: il worker
        # ri-scarica la miniatura prima della scadenza. Vedi providers/youtube.py.
        'rinnovo_obbligatorio': True,
    },
}

DEFAULT_PROVIDER = 'tpdb'
# Ordine di interrogazione predefinito quando l'admin non ne ha scelto uno.
ORDINE_PREDEFINITO = ['tpdb', 'tmdb', 'youtube']


def get_provider(nome, token=None):
    """
    Istanzia un provider dal nome. Ricade sul default se il nome e' ignoto,
    cosi' un valore sporco in Impostazioni non blocca il worker.
    """
    classe = PROVIDERS.get((nome or '').strip().lower())
    if classe is None:
        classe = PROVIDERS[DEFAULT_PROVIDER]
    return classe(token=token)


def provider_disponibili():
    """Elenco degli id registrati, nell'ordine predefinito."""
    ordinati = [p for p in ORDINE_PREDEFINITO if p in PROVIDERS]
    ordinati += [p for p in PROVIDERS if p not in ordinati]
    return ordinati
