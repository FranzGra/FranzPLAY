# ============================================================================
# Dockerfile DEDICATO al worker sottotitoli (faster-whisper).
# ============================================================================
# Separato dal Docker_Config/Python condiviso dagli altri 4 worker: faster-whisper
# tira dentro CTranslate2/onnxruntime/av (~centinaia di MB) e non vogliamo gonfiare
# watcher/meta/assets/optimizer che non ne hanno bisogno.
#
# La TRADUZIONE multilingua NON e' in questo container: gira nel servizio
# LibreTranslate separato, che il worker chiama via HTTP (vedi worker_subtitles.py).
#
# Target hardware: ZimaBlade x86_64. faster-whisper gira su CPU con quantizzazione
# INT8 (compute_type=int8): basso uso RAM, nessuna GPU richiesta.
# ============================================================================
FROM python:3.11-slim
WORKDIR /app

# ffmpeg: estrazione traccia audio dal video prima della trascrizione.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# I modelli Whisper vengono scaricati a runtime nella prima esecuzione e cachati
# su un volume nominato montato qui (vedi docker-compose), cosi' non si riscaricano
# ad ogni rebuild/restart del container.
ENV HF_HOME=/models
ENV WHISPER_MODEL_DIR=/models

# Il worker gira come www-data (uid 33) per poter scrivere i .vtt nelle cartelle
# asset di /percorsoVideo. Creiamo /models con quell'owner: un volume nominato
# montato su un path che ESISTE nell'immagine ne eredita owner/permessi alla prima
# creazione, così il processo non-root può scaricarci i modelli (altrimenti il
# volume nasce root-owned e il download fallisce con PermissionError).
RUN mkdir -p /models && chown -R 33:33 /models
