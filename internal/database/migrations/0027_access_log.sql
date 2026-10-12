-- logins is the access log: every try to log in, who, when and from which
-- address, so the administrator can see who entered and spot someone
-- guessing passwords. It keeps the last 90 days and at most 10000 rows.
CREATE TABLE logins (
    id      INTEGER PRIMARY KEY,
    at      INTEGER NOT NULL, -- Unix seconds
    name    TEXT    NOT NULL, -- the name typed, even when no such user exists
    user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    address TEXT    NOT NULL, -- where the request came from
    outcome TEXT    NOT NULL CHECK (outcome IN ('entered', 'wrong_password', 'locked'))
) STRICT;

CREATE INDEX logins_at ON logins (at);

-- last_login is when each user last entered, shown in the list of people.
ALTER TABLE users ADD COLUMN last_login INTEGER; -- Unix seconds; NULL if never
