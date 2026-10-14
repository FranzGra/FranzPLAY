-- video_audio are the sound tracks inside the video files, like the
-- Italian and the English of a film. The 'tracks' job reads them.
CREATE TABLE video_audio (
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    stream     INTEGER NOT NULL CHECK (stream >= 0),          -- its number inside the file
    lang       TEXT    NOT NULL CHECK (length(lang) <= 20),   -- '' = not said
    title      TEXT    NOT NULL CHECK (length(title) <= 100), -- '' = none
    codec      TEXT    NOT NULL CHECK (length(codec) <= 30),  -- '' = not said
    channels   INTEGER NOT NULL CHECK (channels BETWEEN 0 AND 64),
    is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
    PRIMARY KEY (video_id, stream)
) STRICT;

-- The videos whose tracks were already read are read again, to find
-- their sound tracks. It is quick: the subtitles already copied stay.
UPDATE jobs SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = unixepoch()
WHERE kind = 'tracks' AND state = 'done';
