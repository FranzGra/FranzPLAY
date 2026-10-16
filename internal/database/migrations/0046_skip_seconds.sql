-- skip_seconds is how far the player jumps forward or back for a person:
-- the buttons, the arrow keys and the double taps. 15 for everybody until
-- they choose another one in the player's settings.
ALTER TABLE users ADD COLUMN skip_seconds INTEGER NOT NULL DEFAULT 15 CHECK (skip_seconds IN (5, 10, 15, 20, 30));
