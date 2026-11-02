-- moved_files are the files "franzplay migrate-content" copied to the new
-- folders and checked. The old copy may be deleted only by its --remove-old,
-- after checking both again, and only if it is one of these: a file that is not
-- here was never copied. new_path may name a file changed later: then the
-- hashes differ, and the old copy stays.
CREATE TABLE moved_files (
    old_path   TEXT    NOT NULL PRIMARY KEY,
    new_path   TEXT    NOT NULL,
    size       INTEGER NOT NULL,
    old_sha256 TEXT    NOT NULL,
    new_sha256 TEXT    NOT NULL, -- different from old_sha256 for a model's settings, which name their folder
    moved_at   INTEGER NOT NULL  -- Unix seconds
) STRICT;

CREATE INDEX moved_files_new ON moved_files (new_path);
