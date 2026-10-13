-- clip_hd is the file name, in the data folder's clips-hd/ folder, of the
-- same clip as clip, made sharper (720 pixels high) for browsers on a
-- good connection. NULL = none yet.
ALTER TABLE videos ADD COLUMN clip_hd TEXT;

-- Clips made before have no sharp twin yet: make them again. The job
-- worker does it in the background, one at a time, like any other job.
UPDATE jobs SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = unixepoch()
WHERE kind = 'clip' AND state = 'done';
