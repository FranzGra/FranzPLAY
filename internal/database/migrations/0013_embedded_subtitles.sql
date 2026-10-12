-- video_subtitles are the text subtitles inside the video files. The
-- 'tracks' job copies each one, as WebVTT, into the data folder's
-- subtitles/ folder: the video file itself is only read (rule 1).
CREATE TABLE video_subtitles (
    video_id INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    stream   INTEGER NOT NULL CHECK (stream >= 0),          -- its number inside the file
    lang     TEXT    NOT NULL CHECK (length(lang) <= 20),   -- '' = not said
    title    TEXT    NOT NULL CHECK (length(title) <= 100), -- '' = none
    forced   INTEGER NOT NULL CHECK (forced IN (0, 1)),
    file     TEXT    NOT NULL UNIQUE,                       -- the copy, in subtitles/
    PRIMARY KEY (video_id, stream)
) STRICT;

-- The job queue gets a new kind of work, 'tracks'. SQLite cannot
-- change a CHECK, so the table is made again with the same rows.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'cover', 'preview', 'tracks')),
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

-- Videos already read by ffprobe still need their subtitles looked for.
-- A missing video waits: when its disk comes back, the scan asks for them.
INSERT INTO jobs (video_id, kind, state, updated_at)
SELECT j.video_id, 'tracks', 'pending', unixepoch()
FROM jobs j JOIN videos v ON v.id = j.video_id
WHERE j.kind = 'probe' AND j.state = 'done' AND v.missing_since IS NULL;
