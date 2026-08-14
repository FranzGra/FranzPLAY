# image_fetch.py
# ----------------------------------------------------------------------------
# Download SICURO di immagini da URL esterni (copertine dei provider online).
#
# PERCHE' TUTTO QUESTO HARDENING:
# L'URL non lo sceglie l'utente ne' noi: arriva dalla risposta JSON di un
# servizio di terze parti. E' input non fidato a tutti gli effetti.
#
# Guardie implementate (tutte verificate sul campo prima della stesura):
#   1. SSRF   -> https obbligatorio + risoluzione DNS + rifiuto di ogni IP
#                privato/loopback/link-local/riservato, RIVERIFICATO A OGNI HOP
#                di redirect (i redirect si seguono a mano, non con requests).
#                NB: una allowlist di host NON e' praticabile, le immagini di
#                TPDB stanno anche su CDN di studio terzi
#                (es. media-public-ht.project1content.com).
#   2. Bombe  -> limite hard sui byte scaricati, streaming a chunk.
#   3. Tipo   -> l'estensione si deduce dai MAGIC BYTES, mai dall'URL ne' dal
#                Content-Type. Verificato: un file servito come ".webp" da
#                cdn.theporndb.net e' in realta' un JPEG. Scrivere ".webp" con
#                dentro un JPEG farebbe servire a stream.php un MIME sbagliato.
#   4. Atomic -> scrittura su .tmp + os.replace(), cosi' un crash a meta'
#                download non lascia mai un file parziale che il watcher
#                registrerebbe come copertina valida.
# ----------------------------------------------------------------------------

import ipaddress
import logging
import os
import socket
from urllib.parse import urljoin, urlsplit

import requests

# Limite dimensione immagine (default 8 MB): una copertina reale pesa 100-800 KB.
MAX_IMAGE_BYTES = int(os.environ.get('COVERS_MAX_IMAGE_BYTES', str(8 * 1024 * 1024)))
HTTP_TIMEOUT = int(os.environ.get('COVERS_HTTP_TIMEOUT', '20'))
MAX_REDIRECTS = 3

# Firme binarie -> estensione. L'ordine non conta, sono mutuamente esclusive.
_MAGIC_SIGNATURES = [
    (b"\xff\xd8\xff", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
]

USER_AGENT = 'FranzPLAY/1.0 (self-hosted media server)'


class ImageFetchError(Exception):
    """Errore di download/validazione immagine. Il messaggio finisce in UI."""
    pass


def _risolve_a_ip_pubblico(hostname):
    """
    True solo se OGNI indirizzo a cui l'host risolve e' pubblico e instradabile.
    Blocca gli attacchi SSRF classici: 127.0.0.1, 192.168.x, 10.x, ::1 e
    soprattutto 169.254.169.254 (endpoint metadata dei cloud provider).
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            return False
    return True


def url_consentito(url):
    """Ritorna (ok: bool, motivo: str). Motivo vuoto se ok."""
    if not url or not isinstance(url, str):
        return False, "URL mancante"
    try:
        parts = urlsplit(url)
    except ValueError:
        return False, "URL malformato"
    if parts.scheme != 'https':
        return False, "schema non https"
    if not parts.hostname:
        return False, "host mancante"
    if not _risolve_a_ip_pubblico(parts.hostname):
        return False, "l'host risolve a un IP privato o riservato (possibile SSRF)"
    return True, ""


def deduci_estensione(primi_byte):
    """Estensione dedotta dai magic bytes. None se non e' un'immagine nota."""
    for magic, ext in _MAGIC_SIGNATURES:
        if primi_byte.startswith(magic):
            return ext
    # WEBP: "RIFF" + 4 byte di lunghezza + "WEBP"
    if primi_byte[:4] == b'RIFF' and primi_byte[8:12] == b'WEBP':
        return 'webp'
    return None


def scarica_immagine(url, destinazione_senza_estensione, max_bytes=None):
    """
    Scarica un'immagine e la scrive atomicamente.

    `destinazione_senza_estensione` e' il path COMPLETO senza suffisso: viene
    aggiunta l'estensione dedotta dal contenuto reale.

    Ritorna (path_scritto, estensione, byte_scritti).
    Solleva ImageFetchError in caso di rifiuto o fallimento.
    """
    limite = max_bytes or MAX_IMAGE_BYTES
    corrente = url

    for _ in range(MAX_REDIRECTS + 1):
        ok, motivo = url_consentito(corrente)
        if not ok:
            raise ImageFetchError("URL rifiutato (%s)" % motivo)

        try:
            risposta = requests.get(
                corrente, stream=True, timeout=HTTP_TIMEOUT,
                allow_redirects=False,          # i redirect li validiamo noi
                headers={'User-Agent': USER_AGENT},
            )
        except requests.RequestException as e:
            raise ImageFetchError("errore di rete: %s" % e)

        # Redirect: nuovo giro, con nuova validazione dell'host di destinazione.
        if risposta.status_code in (301, 302, 303, 307, 308):
            prossimo = risposta.headers.get('Location', '')
            risposta.close()
            if not prossimo:
                raise ImageFetchError("redirect senza header Location")
            # Location puo' essere RELATIVO ("/img/bg.jpg"): senza urljoin
            # url_consentito lo rifiutava con "schema non https" e il download
            # falliva su CDN perfettamente legittimi. urljoin risolve rispetto
            # all'URL corrente, esattamente come fa CURLINFO_REDIRECT_URL nel
            # gemello PHP (cover_provider.php).
            corrente = urljoin(corrente, prossimo)
            continue

        try:
            if risposta.status_code != 200:
                raise ImageFetchError("HTTP %d dal server immagini" % risposta.status_code)

            primi_byte = b''
            pezzi = []
            totale = 0
            for chunk in risposta.iter_content(65536):
                if not chunk:
                    continue
                # ACCUMULIAMO finche' non abbiamo almeno 16 byte, invece di
                # fidarci del primo chunk: con Transfer-Encoding chunked il
                # primo pezzo puo' essere piu' corto di 12 byte, e il
                # riconoscimento WEBP (che legge i byte 8-12) falliva
                # scartando un'immagine valida.
                if len(primi_byte) < 16:
                    primi_byte = (primi_byte + chunk)[:16]
                totale += len(chunk)
                if totale > limite:
                    raise ImageFetchError(
                        "immagine troppo grande (oltre %d byte)" % limite)
                pezzi.append(chunk)
        finally:
            risposta.close()

        if totale == 0:
            raise ImageFetchError("risposta vuota")

        estensione = deduci_estensione(primi_byte)
        if not estensione:
            raise ImageFetchError(
                "il contenuto non e' un'immagine riconosciuta (magic=%r)" % primi_byte[:8])

        path_finale = "%s.%s" % (destinazione_senza_estensione, estensione)
        path_tmp = path_finale + ".tmp"
        try:
            cartella = os.path.dirname(path_finale)
            if cartella and not os.path.isdir(cartella):
                os.makedirs(cartella, exist_ok=True)
            with open(path_tmp, 'wb') as f:
                f.write(b''.join(pezzi))
            os.replace(path_tmp, path_finale)
        except OSError as e:
            try:
                if os.path.exists(path_tmp):
                    os.unlink(path_tmp)
            except OSError:
                pass
            raise ImageFetchError("scrittura su disco fallita: %s" % e)

        logging.info("[ImageFetch] Scaricata %s (%d byte) -> %s",
                     estensione.upper(), totale, path_finale)
        return path_finale, estensione, totale

    raise ImageFetchError("troppi redirect consecutivi")
