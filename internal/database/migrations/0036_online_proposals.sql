-- "Chiedi conferma": when the administrator wants to see what a source on
-- the internet found before it is used, it waits here, one proposal per
-- video, until they say yes (it moves to the online_ columns of videos)
-- or no (it goes). fingerprint is the content it was found for: when the
-- file changes, the proposal no longer fits it and is not shown.
CREATE TABLE online_proposals (
    video_id     INTEGER PRIMARY KEY REFERENCES videos (id) ON DELETE CASCADE,
    fingerprint  TEXT    NOT NULL,
    source       TEXT    NOT NULL CHECK (source IN ('youtube', 'tmdb', 'tpdb')),
    title        TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200),
    description  TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 5000),
    author       TEXT CHECK (author IS NULL OR length(author) BETWEEN 1 AND 100),
    published_on TEXT CHECK (published_on IS NULL OR published_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    image        TEXT,             -- file name in the data folder's online/ folder
    found_at     INTEGER NOT NULL  -- Unix seconds
) STRICT;
