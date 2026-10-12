-- invites let an administrator bring in family and friends: a link that
-- creates one account, once, within a few days. As with sessions, only a
-- hash of the link's code is kept: someone who reads the database cannot
-- use it to join.
CREATE TABLE invites (
    id         INTEGER PRIMARY KEY,
    token_hash BLOB    NOT NULL UNIQUE,
    note       TEXT    NOT NULL DEFAULT '' CHECK (length(note) <= 60), -- who it is for, to remember
    can_upload INTEGER NOT NULL DEFAULT 0 CHECK (can_upload IN (0, 1)),
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL, -- Unix seconds
    expires_at INTEGER NOT NULL, -- Unix seconds
    used_by    INTEGER REFERENCES users (id) ON DELETE SET NULL,
    used_at    INTEGER           -- Unix seconds; NULL while it waits
) STRICT;
