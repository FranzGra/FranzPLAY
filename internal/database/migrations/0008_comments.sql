-- comments are what people write under a video. A reply points to the
-- comment it answers (parent_id); replies have no replies of their own,
-- so a conversation stays easy to follow.
CREATE TABLE comments (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    parent_id  INTEGER REFERENCES comments (id) ON DELETE CASCADE, -- NULL = not a reply
    body       TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    created_at INTEGER NOT NULL -- Unix seconds
) STRICT;

-- The comments of a video, in order.
CREATE INDEX comments_video ON comments (video_id, created_at);
