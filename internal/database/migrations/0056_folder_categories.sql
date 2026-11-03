-- Every folder with videos of its own is a category, at any depth: a
-- video's folder_category becomes the path of its folder inside the
-- library ("Serie A/Stagione 1"), no longer its first folder. The scan
-- writes the new paths the first time it runs, from the paths in the
-- catalog: no file is read, and likes, history and the rest stay with
-- their videos.
--
-- folder_categories is the name people see of each of those categories,
-- made by the scan: the last folder ("Stagione 1"), or as many folders
-- above as it takes when two would show the same ("Serie A › Stagione 1").
-- What the administrator chose (categories.label) wins over it.
CREATE TABLE folder_categories (
    name  TEXT NOT NULL PRIMARY KEY CHECK (name != ''),
    shown TEXT NOT NULL CHECK (shown != '')
) STRICT, WITHOUT ROWID;
