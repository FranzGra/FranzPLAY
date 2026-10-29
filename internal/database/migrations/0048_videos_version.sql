-- videos_version counts the changes to what lists of videos show: a video
-- added or removed, or one whose title, category, date or visibility
-- changed. A feature that keeps the whole library in memory (the
-- suggestions) reads this one number to know whether its copy is still
-- right, instead of reading ten thousand videos at every page.
--
-- The triggers name only generated and plain columns through old/new, so
-- a migration that drops one of those columns must drop the trigger
-- videos_version_update first and create it again after.
CREATE TABLE videos_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    n  INTEGER NOT NULL
);
INSERT INTO videos_version (id, n) VALUES (1, 0);

CREATE TRIGGER videos_version_insert AFTER INSERT ON videos
BEGIN
    UPDATE videos_version SET n = n + 1 WHERE id = 1;
END;

CREATE TRIGGER videos_version_delete AFTER DELETE ON videos
BEGIN
    UPDATE videos_version SET n = n + 1 WHERE id = 1;
END;

CREATE TRIGGER videos_version_update AFTER UPDATE ON videos
WHEN old.shown_title IS NOT new.shown_title
    OR old.category IS NOT new.category
    OR old.visible IS NOT new.visible
    OR old.added_at IS NOT new.added_at
BEGIN
    UPDATE videos_version SET n = n + 1 WHERE id = 1;
END;
