-- urgent_at is when a job was put first, in milliseconds: among the jobs put
-- first, the last one chosen runs first. The other jobs have 0 and keep their
-- order. Asking for the job again (jobs.Enqueue) makes it ordinary again.
DROP INDEX jobs_next;
ALTER TABLE jobs ADD COLUMN urgent_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX jobs_next ON jobs (priority, urgent_at DESC, id) WHERE state = 'pending';
