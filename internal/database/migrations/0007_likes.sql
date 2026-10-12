-- likes are the videos each person likes. There is no "dislike": among
-- family and friends a like is enough (decision F in docs/visione.md).
CREATE TABLE likes (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, -- Unix seconds
    PRIMARY KEY (user_id, video_id)
) STRICT;

-- Counting the likes of a video.
CREATE INDEX likes_video ON likes (video_id);
