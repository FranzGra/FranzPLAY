-- avatar says whether a person has a profile photo: 0 = none (their
-- initial shows), otherwise when it was last changed, in Unix milliseconds.
-- The photo itself is the file avatars/{id}.jpg in the data folder; the
-- number goes in its address, so a new photo is never confused with an
-- old one the browser kept.
ALTER TABLE users ADD COLUMN avatar INTEGER NOT NULL DEFAULT 0 CHECK (avatar >= 0);
