-- settings keeps small values FranzPLAY decides for itself, such as the
-- secrets it generates on first start. One row per key.
CREATE TABLE settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;
