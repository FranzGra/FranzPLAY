-- The worker takes the next job by kind (probes first, conversions last),
-- then by age. Worked out at every pick, that order made SQLite sort all
-- the waiting jobs each time: tens of thousands on a first scan of a big
-- library, while videos were playing. Kept in a column with an index, the
-- next job is found at once.
--
-- The order of the kinds lives only here.
ALTER TABLE jobs ADD COLUMN priority INTEGER GENERATED ALWAYS AS (
    CASE kind
        WHEN 'probe' THEN 0
        WHEN 'details' THEN 1
        WHEN 'online' THEN 2
        WHEN 'cover' THEN 3
        WHEN 'preview' THEN 4
        WHEN 'transcribe' THEN 6
        WHEN 'convert' THEN 7
        ELSE 5
    END) VIRTUAL;

CREATE INDEX jobs_next ON jobs (priority, id) WHERE state = 'pending';
