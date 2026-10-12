-- clip is the file name, in the data folder's clips/ folder, of the few
-- silent seconds that play on a video's card when the pointer rests on
-- it. NULL = none yet.
ALTER TABLE videos ADD COLUMN clip TEXT;

-- The job queue gets a new kind of work, 'clip'. SQLite cannot change
-- a CHECK, so the table is made again with the same rows.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'details', 'online', 'cover', 'preview', 'clip', 'tracks', 'convert')),
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

-- Videos already read by ffprobe still need their clip.
INSERT INTO jobs (video_id, kind, state, updated_at)
SELECT video_id, 'clip', 'pending', unixepoch() FROM jobs WHERE kind = 'probe' AND state = 'done';
