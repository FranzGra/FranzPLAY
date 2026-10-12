-- users are the people who can enter FranzPLAY. The first one, created at
-- the first start, is the administrator.
CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL UNIQUE COLLATE NOCASE, -- "Giulia" and "giulia" are the same
    password_hash TEXT    NOT NULL,                       -- never the password itself
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'user')),
    can_upload    INTEGER NOT NULL DEFAULT 0 CHECK (can_upload IN (0, 1)),
    created_at    INTEGER NOT NULL                        -- Unix seconds
) STRICT;

-- sessions are the logged-in browsers. Only a hash of the cookie is kept:
-- someone who reads the database cannot use it to log in.
CREATE TABLE sessions (
    token_hash BLOB    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, -- Unix seconds
    last_seen  INTEGER NOT NULL, -- Unix seconds
    expires_at INTEGER NOT NULL  -- Unix seconds
) STRICT;

CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);
