-- closed_home_rows are the rows of the Home each person closed: they stay
-- closed on every device until the person opens them again. A row not
-- listed is open.
CREATE TABLE closed_home_rows (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    row     TEXT    NOT NULL CHECK (row IN ('continue', 'saved', 'liked', 'recommended', 'latest')),
    PRIMARY KEY (user_id, row)
) STRICT;
