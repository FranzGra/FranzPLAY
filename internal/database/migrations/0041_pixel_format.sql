-- pixel_format is how the picture of a video stores its colours, as
-- ffprobe names it: "yuv420p" is the plain 8-bit picture every device
-- decodes, "yuv420p10le" a 10-bit one that almost no browser plays.
-- NULL: not read yet. The 'probe' job fills it; for the videos read
-- before, the 'convert' job reads it when it needs it.
ALTER TABLE videos ADD COLUMN pixel_format TEXT CHECK (pixel_format IS NULL OR length(pixel_format) <= 32);

-- What plays on every device changed (iPhone, iPad and Mac counted too):
-- every video already read decides again whether it needs a copy. For one
-- that plays as it is, the job ends at once.
INSERT INTO jobs (video_id, kind, state, updated_at)
SELECT id, 'convert', 'pending', unixepoch()
FROM videos
WHERE video_codec IS NOT NULL AND missing_since IS NULL
ON CONFLICT (video_id, kind) DO UPDATE
SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = excluded.updated_at;
