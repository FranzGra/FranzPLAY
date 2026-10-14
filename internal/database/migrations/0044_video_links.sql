-- link_key is the secret part of the link of an uploaded video that
-- "anyone with the link" may watch, like an unlisted video on YouTube; NULL
-- = no link. Such a video is private: it shows up in no list, and only who
-- opens its link (with an account on this FranzPLAY) can watch it.
ALTER TABLE videos ADD COLUMN link_key TEXT;

-- by_link remembers that an upload will be watched by link, until it
-- becomes a video and gets its key.
ALTER TABLE uploads ADD COLUMN by_link INTEGER NOT NULL DEFAULT 0 CHECK (by_link IN (0, 1));

-- video_link_viewers are the people who opened the link of a video, with
-- the key they used: they can watch it while that key is still its link.
-- A new key, or no link any more, leaves them out without deleting them.
CREATE TABLE video_link_viewers (
    video_id INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    link_key TEXT NOT NULL,
    PRIMARY KEY (video_id, user_id)
) STRICT;
