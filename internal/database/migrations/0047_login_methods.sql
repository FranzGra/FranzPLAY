-- login_method is how a person proves who they are: a password, a PIN of
-- 6 digits or a pattern on a grid of 9 dots. password_hash keeps the hash
-- of whichever one it is, never the thing itself.
ALTER TABLE users ADD COLUMN login_method TEXT NOT NULL DEFAULT 'password'
    CHECK (login_method IN ('password', 'pin', 'pattern'));

-- allowed_methods narrows, for one person, the methods the administrator
-- allows on the whole server: a list like "password,pin". NULL means the
-- person follows the server's choice.
ALTER TABLE users ADD COLUMN allowed_methods TEXT;

-- login_blocks remembers wrong tries, so that guessing slows down even
-- across restarts. key is "account:<name in lowercase>" or
-- "address:<ip>". After enough wrong tries the key is blocked until
-- blocked_until, and level grows: each new block lasts longer.
CREATE TABLE login_blocks (
    key           TEXT    PRIMARY KEY,
    failures      INTEGER NOT NULL, -- wrong tries since the last block
    level         INTEGER NOT NULL, -- how many blocks in a row
    blocked_until INTEGER NOT NULL, -- Unix seconds; in the past when not blocked
    last_failure  INTEGER NOT NULL  -- Unix seconds
) STRICT;
