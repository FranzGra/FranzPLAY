-- urgent marks a job someone is waiting for: a person opened a video
-- that their device cannot play, and its copy is not ready yet. It goes
-- before every other job, and a conversion marked urgent does not give way.
-- Asking for the job again (jobs.Enqueue) makes it ordinary again.
ALTER TABLE jobs ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1));

-- The order of the jobs (0035) gets urgent jobs first. A generated column
-- cannot be changed: it is made again.
DROP INDEX jobs_next;
ALTER TABLE jobs DROP COLUMN priority;
ALTER TABLE jobs ADD COLUMN priority INTEGER GENERATED ALWAYS AS (
    CASE
        WHEN urgent THEN -1
        WHEN kind = 'probe' THEN 0
        WHEN kind = 'details' THEN 1
        WHEN kind = 'online' THEN 2
        WHEN kind = 'cover' THEN 3
        WHEN kind = 'preview' THEN 4
        WHEN kind = 'transcribe' THEN 6
        WHEN kind = 'convert' THEN 7
        ELSE 5
    END) VIRTUAL;

CREATE INDEX jobs_next ON jobs (priority, id) WHERE state = 'pending';
