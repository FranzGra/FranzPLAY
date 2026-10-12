-- accent_color is the color a person chose for buttons, links and the
-- progress bar, as "#rrggbb" in small letters. NULL = FranzPLAY's own.
ALTER TABLE users ADD COLUMN accent_color TEXT
    CHECK (accent_color IS NULL OR accent_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
