-- can_share_public lets a person make a public link for their videos: an
-- address anybody can open, even without an account. Off for everybody
-- until the administrator turns it on; administrators may always.
ALTER TABLE users ADD COLUMN can_share_public INTEGER NOT NULL DEFAULT 0 CHECK (can_share_public IN (0, 1));

-- public_links are the videos that anybody with their link may watch
-- without logging in. token is the secret part of the address /p/{token}:
-- random, 132 bits. One link per video; a new one replaces the old, and
-- deleting the row is revoking it. created_by is who made it: when that
-- person may no longer share in public, their links stop working.
CREATE TABLE public_links (
    video_id   INTEGER NOT NULL UNIQUE REFERENCES videos (id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    created_by INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX public_links_by_creator ON public_links (created_by);
