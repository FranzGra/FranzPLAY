-- category_pictures are the pictures in the folder of a category (a
-- first-level folder of a video folder) named like poster.jpg or
-- fanart.jpg (video.IsCategoryPicture). The scan finds them; they are only
-- read (rule 1). file is their light copy in the data folder's
-- category-pictures/ folder, with its size in pixels. pending = 1 means
-- the copy is still to make: the picture is new or changed (the copy
-- made before stays meanwhile). A copy that cannot be made (the file is
-- not really a picture) leaves pending = 0 and file NULL, until the
-- picture changes.
CREATE TABLE category_pictures (
    id         INTEGER PRIMARY KEY,
    library_id INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
    path       TEXT    NOT NULL, -- inside the library, with "/": "Viaggi/poster.jpg"
    category   TEXT    NOT NULL CHECK (category != ''),
    size       INTEGER NOT NULL,
    mod_time   INTEGER NOT NULL, -- Unix nanoseconds
    pending    INTEGER NOT NULL DEFAULT 1 CHECK (pending IN (0, 1)),
    file       TEXT    UNIQUE,
    width      INTEGER CHECK (width > 0),
    height     INTEGER CHECK (height > 0),
    UNIQUE (library_id, path),
    CHECK ((file IS NULL) = (width IS NULL) AND (file IS NULL) = (height IS NULL))
) STRICT;

CREATE INDEX category_pictures_pending ON category_pictures (id) WHERE pending = 1;
