-- The administrator can give a video another title and category. They
-- are kept apart from the ones FranzPLAY finds by itself, so they win
-- over them and survive a rescan; NULL means "as found".
--
-- category becomes the one shown: the administrator's, else the folder's.
-- Every reader keeps reading category; only the scan writes folder_category.
ALTER TABLE videos RENAME COLUMN category TO folder_category;
ALTER TABLE videos ADD COLUMN admin_category TEXT
    CHECK (admin_category IS NULL OR length(admin_category) <= 100); -- '' = no category
ALTER TABLE videos ADD COLUMN category TEXT
    GENERATED ALWAYS AS (coalesce(admin_category, folder_category)) VIRTUAL;

ALTER TABLE videos ADD COLUMN admin_title TEXT
    CHECK (admin_title IS NULL OR length(admin_title) BETWEEN 1 AND 200);
ALTER TABLE videos DROP COLUMN shown_title;
ALTER TABLE videos ADD COLUMN shown_title TEXT
    GENERATED ALWAYS AS (coalesce(admin_title, details_title, online_title, title)) VIRTUAL;
