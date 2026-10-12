-- cover is the file name of the video's cover in the data folder's
-- covers/ folder. NULL means "no cover yet".
ALTER TABLE videos ADD COLUMN cover TEXT;

-- Videos already read by ffprobe still need their cover.
INSERT INTO jobs (video_id, kind, state, updated_at)
SELECT video_id, 'cover', 'pending', unixepoch() FROM jobs WHERE kind = 'probe' AND state = 'done';
