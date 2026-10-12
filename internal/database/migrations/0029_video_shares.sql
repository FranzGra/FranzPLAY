-- video_shares are the people a private uploaded video is shared with:
-- besides its uploader, only they can open it. It still shows up in no
-- list but their «Condivisi con te» page. A video that becomes visible to
-- everybody loses its shares.
CREATE TABLE video_shares (
    video_id INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, user_id)
) STRICT;

-- The videos shared with a person.
CREATE INDEX video_shares_user ON video_shares (user_id);

-- upload_shares remember the people chosen for an upload until it becomes
-- a video; then they move to video_shares.
CREATE TABLE upload_shares (
    upload_id INTEGER NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (upload_id, user_id)
) STRICT;
