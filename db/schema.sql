CREATE TABLE IF NOT EXISTS songs (
  song_id      INTEGER PRIMARY KEY,
  artist_id    INTEGER NOT NULL,
  artist       TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  views        INTEGER,
  catalog_rank INTEGER,
  fingerstyle  INTEGER NOT NULL DEFAULT 0,
  has_chords   INTEGER NOT NULL DEFAULT 0,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  is_junk      INTEGER NOT NULL DEFAULT 0,
  is_blank     INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  videos       TEXT,
  enriched_at  TEXT
);

CREATE TABLE IF NOT EXISTS tracks (
  song_id       INTEGER NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
  track_index   INTEGER NOT NULL,
  instrument_id INTEGER,
  instrument    TEXT    NOT NULL,
  name          TEXT,
  difficulty    INTEGER,
  views         INTEGER,
  tuning        TEXT,
  PRIMARY KEY (song_id, track_index)
);

CREATE TABLE IF NOT EXISTS tags (
  song_id INTEGER NOT NULL REFERENCES songs(song_id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  PRIMARY KEY (song_id, tag)
);

-- Sin foreign key hacia songs, a proposito: el catalogo se puede rebajar
-- entero sin perder el historial. El ETL nunca escribe esta tabla.
CREATE TABLE IF NOT EXISTS song_state (
  song_id     INTEGER PRIMARY KEY,
  status      TEXT CHECK (status IN ('learned','skipped','queued')),
  liked       INTEGER NOT NULL DEFAULT 0,
  shown_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_song ON tracks(song_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag    ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_songs_todo  ON songs(enriched_at) WHERE enriched_at IS NULL;
