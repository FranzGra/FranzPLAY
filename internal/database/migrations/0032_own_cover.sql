-- The administrator can choose the cover of a video: an image they
-- uploaded (own_cover, the name of a file in the data folder's own-covers/
-- folder) or a moment of the video (cover_second). The cover job uses
-- them before anything else, so neither a new reading of the folders nor
-- a search on the internet ever replaces them.
ALTER TABLE videos ADD COLUMN own_cover TEXT;
ALTER TABLE videos ADD COLUMN cover_second INTEGER CHECK (cover_second IS NULL OR cover_second >= 0);
