-- The administrator can choose the clip that plays on a video's card: a
-- video they uploaded (own_clip, the name of a file in the data folder's
-- own-clips/ folder), or none at all (no_clip). The clip job follows the
-- choice, so a new reading of the folders never undoes it.
ALTER TABLE videos ADD COLUMN own_clip TEXT;
ALTER TABLE videos ADD COLUMN no_clip INTEGER NOT NULL DEFAULT 0 CHECK (no_clip IN (0, 1));
