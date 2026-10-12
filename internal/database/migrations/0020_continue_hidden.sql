-- in_continue says whether a video started and not finished shows in
-- "Continua a guardare". The person can take it out without forgetting it
-- from the history; watching it again puts it back.
ALTER TABLE watch_progress ADD COLUMN in_continue INTEGER NOT NULL DEFAULT 1
    CHECK (in_continue IN (0, 1));
