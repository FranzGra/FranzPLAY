-- playlist_shares are the people an ordinary playlist that is not on its
-- owner's channel is shared with: besides its owner, only they can open
-- it, from their «Condivisi con te» page. A playlist put on the channel
-- loses its shares; "Guarda più tardi" is never shared.
CREATE TABLE playlist_shares (
    playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (playlist_id, user_id)
) STRICT;

-- The playlists shared with a person.
CREATE INDEX playlist_shares_user ON playlist_shares (user_id);
