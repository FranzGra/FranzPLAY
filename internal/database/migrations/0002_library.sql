-- libraries are the video folders. A row is never deleted: if a folder is
-- removed from the settings, its videos are simply marked missing.
CREATE TABLE libraries (
    id   INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE
) STRICT;

-- videos is the catalog. A video is identified by its content
-- (fingerprint), not by its path: moving a file keeps the same row.
CREATE TABLE videos (
    id            INTEGER PRIMARY KEY,
    fingerprint   TEXT    NOT NULL UNIQUE,
    library_id    INTEGER NOT NULL REFERENCES libraries (id),
    path          TEXT    NOT NULL,                -- inside the library, with "/"
    size          INTEGER NOT NULL CHECK (size >= 0),
    mod_time      INTEGER NOT NULL,                -- file date, Unix nanoseconds
    title         TEXT    NOT NULL,
    category      TEXT    NOT NULL DEFAULT '',     -- first folder, '' = none
    added_at      INTEGER NOT NULL,                -- Unix seconds
    missing_since INTEGER                          -- Unix seconds, NULL = present
) STRICT;

-- Two present videos cannot be in the same place. A missing video keeps
-- its last path, which another file may now use.
CREATE UNIQUE INDEX videos_present_place
    ON videos (library_id, path) WHERE missing_since IS NULL;

CREATE INDEX videos_added ON videos (added_at);
