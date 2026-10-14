-- too_short is 1 for a video of the video folders that lasts less than the
-- administrator's minimum (the settings row library.min_duration, in
-- seconds; missing or 0 = no minimum). It is only left out of every list:
-- the file and everything about it stay, and changing the minimum brings
-- it back. Videos uploaded from the browser are never too short.
ALTER TABLE videos ADD COLUMN too_short INTEGER NOT NULL DEFAULT 0 CHECK (too_short IN (0, 1));

-- visible, the one place that says which videos people see, now also
-- leaves out the ones too short. Its index goes away with it and comes back.
DROP INDEX videos_shown;
ALTER TABLE videos DROP COLUMN visible;
ALTER TABLE videos ADD COLUMN visible INTEGER
    GENERATED ALWAYS AS (missing_since IS NULL AND hidden_at IS NULL AND private = 0 AND too_short = 0) VIRTUAL;
CREATE INDEX videos_shown ON videos (category) WHERE visible;
