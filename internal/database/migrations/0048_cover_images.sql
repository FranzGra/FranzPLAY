-- cover_image is the version of the picture next to the video, with its
-- name, that becomes its cover (video.CoverImage): '' when there is none,
-- NULL when no scan has looked yet. When a scan sees it change (a picture
-- put there later, replaced or taken away), the cover is made again. The
-- picture itself is only read (rule 1).
ALTER TABLE videos ADD COLUMN cover_image TEXT;
