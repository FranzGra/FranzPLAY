-- preview is the file name, in the data folder's previews/ folder, of the
-- image holding small frames of the video for the timeline of the player:
-- preview_count frames, one every preview_gap seconds. NULL = none yet.
ALTER TABLE videos ADD COLUMN preview       TEXT;
ALTER TABLE videos ADD COLUMN preview_gap   INTEGER CHECK (preview_gap > 0);   -- seconds
ALTER TABLE videos ADD COLUMN preview_count INTEGER CHECK (preview_count > 0);

-- The job queue gets a new kind of work, 'preview'. SQLite cannot change
-- a CHECK, so the table is made again with the same rows.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'cover', 'preview')),
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

-- Videos already read by ffprobe still need their previews.
INSERT INTO jobs (video_id, kind, state, updated_at)
SELECT video_id, 'preview', 'pending', unixepoch() FROM jobs WHERE kind = 'probe' AND state = 'done';
