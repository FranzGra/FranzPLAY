-- upload_quota is how much space, in bytes, a person's uploaded videos
-- may take in the data folder. It only matters when can_upload is on; the
-- administrator changes it for each person. 10 GiB to start with.
ALTER TABLE users ADD COLUMN upload_quota INTEGER NOT NULL DEFAULT 10737418240
    CHECK (upload_quota >= 0);
