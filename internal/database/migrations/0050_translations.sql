-- Listening to a video and translating its subtitles are now two jobs.
-- translation_requests is what the administrator asked to translate, one
-- request per video: the 'translate' job reads it. It can start from the
-- subtitles whisper wrote ('auto'), from a file next to the video ('file')
-- or from the ones inside it ('inside'). redo means the languages already
-- translated are made again; otherwise they are left as they are.
CREATE TABLE translation_requests (
    video_id     INTEGER PRIMARY KEY REFERENCES videos (id) ON DELETE CASCADE,
    source       TEXT    NOT NULL CHECK (source IN ('auto', 'file', 'inside')),
    from_lang    TEXT    NOT NULL CHECK (length(from_lang) BETWEEN 2 AND 3),
    langs        TEXT    NOT NULL CHECK (length(langs) BETWEEN 2 AND 60), -- "it,de"
    redo         INTEGER NOT NULL DEFAULT 0 CHECK (redo IN (0, 1)),
    requested_at INTEGER NOT NULL -- Unix seconds
) STRICT;
CREATE INDEX translation_requests_video ON translation_requests (video_id);

-- The job queue gets a new kind of work, 'translate'. SQLite cannot change
-- a CHECK, so the table is made again with the same rows. Nothing asked or
-- made before is touched, and no job starts again. A translation takes
-- minutes, so it goes before the transcriptions, which take hours, but
-- after the short jobs: it gives way to them, and if it went first it would
-- stop and start again from the beginning while they wait.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'details', 'online', 'cover', 'preview', 'clip', 'tracks', 'translate', 'transcribe', 'convert')),
    state      TEXT    NOT NULL CHECK (state IN ('pending', 'running', 'done', 'failed')),
    attempts   INTEGER NOT NULL DEFAULT 0,
    last_error TEXT    NOT NULL DEFAULT '',
    run_after  INTEGER NOT NULL DEFAULT 0, -- Unix seconds: not before this time
    updated_at INTEGER NOT NULL,           -- Unix seconds
    urgent     INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
    priority   INTEGER GENERATED ALWAYS AS (
        CASE
            WHEN urgent THEN -1
            WHEN kind = 'probe' THEN 0
            WHEN kind = 'details' THEN 1
            WHEN kind = 'online' THEN 2
            WHEN kind = 'cover' THEN 3
            WHEN kind = 'preview' THEN 4
            WHEN kind = 'translate' THEN 6
            WHEN kind = 'transcribe' THEN 7
            WHEN kind = 'convert' THEN 8
            ELSE 5
        END) VIRTUAL,
    started_ms INTEGER,
    ended_ms   INTEGER,
    UNIQUE (video_id, kind)
) STRICT;

INSERT INTO jobs_new (id, video_id, kind, state, attempts, last_error, run_after, updated_at, urgent, started_ms, ended_ms)
SELECT id, video_id, kind, state, attempts, last_error, run_after, updated_at, urgent, started_ms, ended_ms FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE INDEX jobs_waiting ON jobs (state, run_after);
CREATE INDEX jobs_next ON jobs (priority, id) WHERE state = 'pending';
CREATE INDEX jobs_ended ON jobs (ended_ms) WHERE ended_ms IS NOT NULL;
