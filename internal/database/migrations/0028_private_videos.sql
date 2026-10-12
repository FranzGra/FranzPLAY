-- private is 1 for an uploaded video that only the person who uploaded it
-- sees: it stays out of every list, search and playlist, and only its
-- uploader can open its page. The other videos are 0, for everybody.
ALTER TABLE videos ADD COLUMN private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1));

-- An upload remembers the choice until it becomes a video.
ALTER TABLE uploads ADD COLUMN private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1));

-- visible, the one place that says which videos people see, now also
-- leaves out the private ones.
ALTER TABLE videos DROP COLUMN visible;
ALTER TABLE videos ADD COLUMN visible INTEGER
    GENERATED ALWAYS AS (missing_since IS NULL AND hidden_at IS NULL AND private = 0) VIRTUAL;
