-- The look of the categories, chosen by the administrator. name is the
-- category as the videos have it; label is the name people see instead
-- (NULL: name itself); color is like '#2997ff'; image is the name of a
-- JPEG in the data folder's category-images/ folder.
CREATE TABLE categories (
    id    INTEGER PRIMARY KEY,
    name  TEXT    NOT NULL UNIQUE CHECK (name != ''),
    label TEXT    CHECK (label IS NULL OR length(label) BETWEEN 1 AND 100),
    color TEXT    CHECK (color IS NULL OR color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
    image TEXT
) STRICT;
