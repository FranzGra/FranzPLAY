-- public says a list shows on its owner's channel, where everyone logged
-- in can see it and play it; only the owner can change it. "Guarda più
-- tardi" is always private.
ALTER TABLE playlists ADD COLUMN public INTEGER NOT NULL DEFAULT 0
    CHECK (public IN (0, 1) AND NOT (public = 1 AND kind = 'later'));

-- The public lists of a channel.
CREATE INDEX playlists_public ON playlists (user_id, updated_at) WHERE public = 1;
