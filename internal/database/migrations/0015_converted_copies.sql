-- converted is the copy of a video that every browser plays, made by the
-- 'convert' job in the data folder's converted/ folder when the file
-- itself does not play everywhere. NULL: no copy (none needed, or not
-- made yet). The video file itself is only read (rule 1).
ALTER TABLE videos ADD COLUMN converted TEXT CHECK (converted IS NULL OR length(converted) <= 100);
CREATE UNIQUE INDEX videos_converted ON videos (converted) WHERE converted IS NOT NULL;

-- The job queue gets a new kind of work, 'convert'. SQLite cannot
-- change a CHECK, so the table is made again with the same rows.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'cover', 'preview', 'tracks', 'convert')),
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

-- Every video already read decides for itself whether it needs a copy:
-- for one that plays as it is, the job ends at once.
INSERT INTO jobs (video_id, kind, state, updated_at)
SELECT j.video_id, 'convert', 'pending', unixepoch()
FROM jobs j JOIN videos v ON v.id = j.video_id
WHERE j.kind = 'probe' AND j.state = 'done' AND v.missing_since IS NULL;
