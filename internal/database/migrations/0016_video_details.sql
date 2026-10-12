-- What a file next to the video says about it, like the .info.json that
-- yt-dlp writes: the real title, a description, who published it and
-- when. Read by the 'details' job; NULL when there is no such file. The
-- file itself is only read (rule 1).
ALTER TABLE videos ADD COLUMN details_title TEXT
    CHECK (details_title IS NULL OR length(details_title) BETWEEN 1 AND 200);
ALTER TABLE videos ADD COLUMN description TEXT
    CHECK (description IS NULL OR length(description) BETWEEN 1 AND 5000);
ALTER TABLE videos ADD COLUMN author TEXT
    CHECK (author IS NULL OR length(author) BETWEEN 1 AND 100);
ALTER TABLE videos ADD COLUMN published_on TEXT
    CHECK (published_on IS NULL OR published_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

-- shown_title is the one place that says which title people see: the one
-- of the details file, or else the one made from the file name.
ALTER TABLE videos ADD COLUMN shown_title TEXT
    GENERATED ALWAYS AS (coalesce(details_title, title)) VIRTUAL;

-- The job queue gets a new kind of work, 'details'. SQLite cannot change
-- a CHECK, so the table is made again with the same rows.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'details', 'cover', 'preview', 'tracks', 'convert')),
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

-- Every video already found looks for its details file.
INSERT INTO jobs (video_id, kind, state, updated_at)
SELECT id, 'details', 'pending', unixepoch() FROM videos WHERE missing_since IS NULL;
