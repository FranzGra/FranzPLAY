-- started_ms and ended_ms are when a job last started and last ended
-- (done or failed), in milliseconds since 1970: the administrator's page
-- shows what is running since when, and what ended in the last day and
-- how long it took. NULL = never, or not since this version.
ALTER TABLE jobs ADD COLUMN started_ms INTEGER;
ALTER TABLE jobs ADD COLUMN ended_ms   INTEGER;

-- The jobs that ended recently, newest first, without reading them all.
CREATE INDEX jobs_ended ON jobs (ended_ms) WHERE ended_ms IS NOT NULL;

-- The previews made before were read from key frames only: the frame
-- shown for a moment could be one from seconds earlier, the same frame
-- several times, and the end of short videos was missing. Make them again,
-- with the real frame of each moment. The worker does it in the
-- background, one at a time; meanwhile the old ones keep working.
UPDATE jobs SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = unixepoch()
WHERE kind = 'preview' AND state = 'done';
