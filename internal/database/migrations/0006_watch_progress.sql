-- watch_progress remembers, for each person, where they stopped in each
-- video: it powers "Continua a guardare" and, later, the history.
CREATE TABLE watch_progress (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    position   INTEGER NOT NULL CHECK (position >= 0),          -- seconds
    finished   INTEGER NOT NULL DEFAULT 0 CHECK (finished IN (0, 1)),
    updated_at INTEGER NOT NULL,                                -- Unix seconds
    PRIMARY KEY (user_id, video_id)
) STRICT;

CREATE INDEX watch_progress_recent ON watch_progress (user_id, updated_at);
