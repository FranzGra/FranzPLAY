-- What a source on the internet says about a video (YouTube, and later
-- film databases), when the administrator turns one on. Read by the
-- 'online' job; NULL when nothing was found or no source is on. Kept apart
-- from the columns of the files next to the video: those win, field by
-- field, because the person put them there.
ALTER TABLE videos ADD COLUMN online_title TEXT
    CHECK (online_title IS NULL OR length(online_title) BETWEEN 1 AND 200);
ALTER TABLE videos ADD COLUMN online_description TEXT
    CHECK (online_description IS NULL OR length(online_description) BETWEEN 1 AND 5000);
ALTER TABLE videos ADD COLUMN online_author TEXT
    CHECK (online_author IS NULL OR length(online_author) BETWEEN 1 AND 100);
ALTER TABLE videos ADD COLUMN online_published_on TEXT
    CHECK (online_published_on IS NULL OR online_published_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
-- online_cover is the file name of the downloaded picture in the data
-- folder's online/ folder. The cover job turns it into the cover.
ALTER TABLE videos ADD COLUMN online_cover TEXT;

-- The shown_ columns are the one place that says what people see: the
-- files next to the video first, then the internet, then the file name.
ALTER TABLE videos DROP COLUMN shown_title;
ALTER TABLE videos ADD COLUMN shown_title TEXT
    GENERATED ALWAYS AS (coalesce(details_title, online_title, title)) VIRTUAL;
ALTER TABLE videos ADD COLUMN shown_description TEXT
    GENERATED ALWAYS AS (coalesce(description, online_description)) VIRTUAL;
ALTER TABLE videos ADD COLUMN shown_author TEXT
    GENERATED ALWAYS AS (coalesce(author, online_author)) VIRTUAL;
ALTER TABLE videos ADD COLUMN shown_published_on TEXT
    GENERATED ALWAYS AS (coalesce(published_on, online_published_on)) VIRTUAL;

-- The job queue gets a new kind of work, 'online'. SQLite cannot change
-- a CHECK, so the table is made again with the same rows.
CREATE TABLE jobs_new (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'details', 'online', 'cover', 'preview', 'tracks', 'convert')),
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
