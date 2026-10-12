-- uploaded_by is the person who uploaded a video from the browser; NULL
-- for the videos of the video folders. Uploaded videos live in the data
-- folder's uploads/ folder, which FranzPLAY scans like a video folder.
-- When the person goes away, the video stays.
ALTER TABLE videos ADD COLUMN uploaded_by INTEGER REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX videos_uploaded_by ON videos (uploaded_by) WHERE uploaded_by IS NOT NULL;

-- uploads are videos on their way from a browser. The file grows piece by
-- piece in the data folder's incoming/ folder: if the connection drops,
-- the upload goes on from received. When the last piece arrives the file
-- becomes a video and its row here goes away.
CREATE TABLE uploads (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 255), -- on the person's computer
    title      TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    size       INTEGER NOT NULL CHECK (size > 0),                       -- bytes
    received   INTEGER NOT NULL DEFAULT 0 CHECK (received BETWEEN 0 AND size),
    created_at INTEGER NOT NULL, -- Unix seconds
    updated_at INTEGER NOT NULL  -- Unix seconds: the last piece received
) STRICT;

CREATE INDEX uploads_user ON uploads (user_id);
