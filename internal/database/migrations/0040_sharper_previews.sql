-- preview_width and preview_height are the size, in pixels, of one frame
-- in the image of previews. It is saved with each image because it can
-- change between versions of FranzPLAY: the player must read every image
-- with the size it was made with. NULL = no previews yet.
ALTER TABLE videos ADD COLUMN preview_width  INTEGER CHECK (preview_width > 0);
ALTER TABLE videos ADD COLUMN preview_height INTEGER CHECK (preview_height > 0);

-- Images made before have the old small frames.
UPDATE videos SET preview_width = 160, preview_height = 90 WHERE preview IS NOT NULL;

-- Make them again, sharper. The job worker does it in the background, one
-- at a time, like any other job; meanwhile the old ones keep working.
UPDATE jobs SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = unixepoch()
WHERE kind = 'preview' AND state = 'done';
