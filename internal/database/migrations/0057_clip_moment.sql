-- The administrator can choose where a video's clip starts (clip_second,
-- a second of the video, chosen with the slider like the cover's moment)
-- and how long it lasts (clip_seconds). NULL is the site's choice, kept in
-- settings (clips.start_percent and clips.seconds), or else the clip
-- FranzPLAY always made. Nothing already there changes.
ALTER TABLE videos ADD COLUMN clip_second INTEGER CHECK (clip_second IS NULL OR clip_second >= 0);
ALTER TABLE videos ADD COLUMN clip_seconds INTEGER CHECK (clip_seconds IS NULL OR clip_seconds BETWEEN 2 AND 30);
