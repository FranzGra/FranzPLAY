-- playlists are the lists each person makes of videos to keep together.
-- Everyone also has one "Guarda più tardi" list (kind 'later'), made the
-- first time it is needed; it has no name of its own and cannot be
-- renamed or deleted.
CREATE TABLE playlists (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('playlist', 'later')),
    name       TEXT    NOT NULL CHECK (length(name) <= 100),
    created_at INTEGER NOT NULL, -- Unix seconds
    updated_at INTEGER NOT NULL, -- Unix seconds: created, renamed or a video added
    CHECK ((kind = 'later') = (name = ''))
) STRICT;

-- A person's lists, and at most one "Guarda più tardi" each.
CREATE INDEX playlists_user ON playlists (user_id, updated_at);
CREATE UNIQUE INDEX playlists_later ON playlists (user_id) WHERE kind = 'later';

-- playlist_items are the videos of a list, in order.
CREATE TABLE playlist_items (
    playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    video_id    INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    position    INTEGER NOT NULL, -- 1, 2, 3…; gaps are fine
    added_at    INTEGER NOT NULL, -- Unix seconds
    PRIMARY KEY (playlist_id, video_id)
) STRICT;

-- The lists a video is in.
CREATE INDEX playlist_items_video ON playlist_items (video_id);
