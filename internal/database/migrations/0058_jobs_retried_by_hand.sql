-- retried marks a failed job the administrator asked to try again ("Try
-- again", "Try all again"). Its attempts start again from 0, like new work,
-- but it is not new work: a long conversion or translation does not stop
-- for it, as a transcription never does. Asking for the job again
-- (jobs.Enqueue) makes it new work again.
ALTER TABLE jobs ADD COLUMN retried INTEGER NOT NULL DEFAULT 0 CHECK (retried IN (0, 1));
