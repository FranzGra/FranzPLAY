-- home_look is how each person likes the video cards of their Home on a
-- computer or tablet: how many in a line, how big, and how much of each
-- section to show. A person not listed has the defaults.
CREATE TABLE home_look (
    user_id  INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    -- 0 means "auto": the card size decides how many fit in a line.
    columns  INTEGER NOT NULL CHECK (columns = 0 OR columns BETWEEN 2 AND 6),
    size     INTEGER NOT NULL CHECK (size BETWEEN 1 AND 5),
    sections TEXT    NOT NULL CHECK (sections IN ('one', 'two', 'scroll'))
) STRICT;
