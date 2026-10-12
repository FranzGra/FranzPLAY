-- hidden_at is when an administrator hid the video, in Unix seconds. A
-- hidden video keeps its likes, comments and place in playlists, but
-- nobody sees it until it is shown again. NULL = shown.
ALTER TABLE videos ADD COLUMN hidden_at INTEGER;

-- visible is the one place that says which videos people see: the ones
-- found in their folder and not hidden. SQLite computes it when read.
ALTER TABLE videos ADD COLUMN visible INTEGER
    GENERATED ALWAYS AS (missing_since IS NULL AND hidden_at IS NULL) VIRTUAL;
