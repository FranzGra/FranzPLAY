-- The folders of contents the database saw lose their video. Only these may be
-- deleted at start: a folder the database never heard of stays, because it may
-- hold hours of work for a video that has not arrived yet.
CREATE TABLE retired_folders (
    fingerprint  TEXT    NOT NULL PRIMARY KEY,
    remove_after INTEGER NOT NULL -- Unix seconds
) STRICT;

-- A row gone (a video forgotten, an upload deleted) says it for its folder.
CREATE TRIGGER videos_retire_folder AFTER DELETE ON videos
BEGIN
    INSERT INTO retired_folders (fingerprint, remove_after) VALUES (OLD.fingerprint, unixepoch())
    ON CONFLICT (fingerprint) DO UPDATE SET remove_after = excluded.remove_after;
END;
