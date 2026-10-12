-- What ffprobe found in each video. NULL means "not read yet".
ALTER TABLE videos ADD COLUMN duration    INTEGER CHECK (duration >= 0); -- seconds
ALTER TABLE videos ADD COLUMN width       INTEGER CHECK (width > 0);     -- as shown on screen
ALTER TABLE videos ADD COLUMN height      INTEGER CHECK (height > 0);
ALTER TABLE videos ADD COLUMN video_codec TEXT;
ALTER TABLE videos ADD COLUMN audio_codec TEXT;                          -- '' = no sound
ALTER TABLE videos ADD COLUMN container   TEXT;

-- jobs is the queue of heavy work (ffprobe, ffmpeg), done one at a time.
-- A job is for one video and one kind of work; asking again resets it.
CREATE TABLE jobs (
    id         INTEGER PRIMARY KEY,
    video_id   INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('probe', 'cover')),
    state      TEXT    NOT NULL CHECK (state IN ('pending', 'running', 'done', 'failed')),
    attempts   INTEGER NOT NULL DEFAULT 0,
    last_error TEXT    NOT NULL DEFAULT '',
    run_after  INTEGER NOT NULL DEFAULT 0, -- Unix seconds: not before this time
    updated_at INTEGER NOT NULL,           -- Unix seconds
    UNIQUE (video_id, kind)
) STRICT;

CREATE INDEX jobs_waiting ON jobs (state, run_after);

-- Videos found before this migration still need to be read.
INSERT INTO jobs (video_id, kind, state, updated_at)
SELECT id, 'probe', 'pending', unixepoch() FROM videos;
