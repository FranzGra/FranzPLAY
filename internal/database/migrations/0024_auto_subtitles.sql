-- subtitle_requests are the automatic subtitles the administrator asked
-- for, one request per video: the 'transcribe' job reads it.
CREATE TABLE subtitle_requests (
    video_id     INTEGER PRIMARY KEY REFERENCES videos (id) ON DELETE CASCADE,
    spoken       TEXT    NOT NULL CHECK (length(spoken) <= 3), -- '' = whisper guesses
    model        TEXT    NOT NULL CHECK (length(model) BETWEEN 1 AND 60),
    langs        TEXT    NOT NULL CHECK (length(langs) <= 60), -- "it,en": the subtitles wanted
    stage        TEXT    NOT NULL DEFAULT '' CHECK (stage IN ('', 'audio', 'transcribe', 'translate')),
    requested_at INTEGER NOT NULL -- Unix seconds
) STRICT;

-- auto_subtitles are the subtitles made by whisper (translated_from = '')
-- and their translations, as WebVTT files in the data folder's
-- autosubtitles/ folder, never next to the video (rule 1). fingerprint is
-- the content they were made from: if the file changes, they are not shown.
CREATE TABLE auto_subtitles (
    video_id        INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    lang            TEXT    NOT NULL CHECK (length(lang) BETWEEN 2 AND 3),
    translated_from TEXT    NOT NULL CHECK (length(translated_from) <= 3),
    model           TEXT    NOT NULL,
    fingerprint     TEXT    NOT NULL,
    file            TEXT    NOT NULL UNIQUE,
    made_at         INTEGER NOT NULL, -- Unix seconds
    PRIMARY KEY (video_id, lang)
) STRICT;

-- The job queue gets a new kind of work, 'transcribe'. SQLite cannot
-- change a CHECK, so the table is made again with the same rows.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'details', 'online', 'cover', 'preview', 'clip', 'tracks', 'transcribe', 'convert')),
    state      TEXT    NOT NULL CHECK (state IN ('pending', 'running', 'done', 'failed')),
    attempts   INTEGER NOT NULL DEFAULT 0,
    last_error TEXT    NOT NULL DEFAULT '',
    run_after  INTEGER NOT NULL DEFAULT 0, -- Unix seconds: not before this time
    updated_at INTEGER NOT NULL,           -- Unix seconds
    UNIQUE (video_id, kind)
) STRICT;

INSERT INTO jobs_new (id, video_id, kind, state, attempts, last_error, run_after, updated_at)
SELECT id, video_id, kind, state, attempts, last_error, run_after, updated_at FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE INDEX jobs_waiting ON jobs (state, run_after);
