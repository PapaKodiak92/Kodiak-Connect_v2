-- Kodiak-Music Postgres foundation
-- This schema is intentionally separate from Synapse/Matrix data.
-- Audio files should live on VPS/object storage; Postgres stores catalog metadata only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS kodiak_music_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  normalized_title text NOT NULL,
  artist_name text NOT NULL DEFAULT '',
  normalized_artist_name text NOT NULL DEFAULT '',
  album_title text NOT NULL DEFAULT '',
  normalized_album_title text NOT NULL DEFAULT '',
  genre_names text[] NOT NULL DEFAULT '{}',
  source_kind text NOT NULL DEFAULT 'library' CHECK (source_kind IN ('library', 'youtube', 'external')),
  file_key text NOT NULL DEFAULT '',
  stream_path text NOT NULL DEFAULT '',
  artwork_path text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT '',
  file_sha256 text UNIQUE,
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  bitrate integer NOT NULL DEFAULT 0 CHECK (bitrate >= 0),
  release_year integer,
  track_number integer,
  explicit boolean NOT NULL DEFAULT false,
  uploaded_by_user_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector NOT NULL DEFAULT ''::tsvector
);

CREATE INDEX IF NOT EXISTS kodiak_music_tracks_search_idx ON kodiak_music_tracks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS kodiak_music_tracks_artist_idx ON kodiak_music_tracks (normalized_artist_name);
CREATE INDEX IF NOT EXISTS kodiak_music_tracks_album_idx ON kodiak_music_tracks (normalized_album_title);
CREATE INDEX IF NOT EXISTS kodiak_music_tracks_created_at_idx ON kodiak_music_tracks (created_at DESC);
CREATE INDEX IF NOT EXISTS kodiak_music_tracks_genres_idx ON kodiak_music_tracks USING gin(genre_names);

CREATE TABLE IF NOT EXISTS kodiak_music_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_user_id text NOT NULL,
  source_device_id text NOT NULL DEFAULT '',
  original_path text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  file_sha256 text NOT NULL,
  file_size_bytes bigint NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexed', 'uploaded', 'failed', 'skipped')),
  track_id uuid REFERENCES kodiak_music_tracks(id) ON DELETE SET NULL,
  error_message text NOT NULL DEFAULT '',
  sync_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kodiak_music_uploads
  ADD COLUMN IF NOT EXISTS sync_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS kodiak_music_uploads_hash_idx ON kodiak_music_uploads (file_sha256);
CREATE INDEX IF NOT EXISTS kodiak_music_uploads_uploader_idx ON kodiak_music_uploads (uploader_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kodiak_music_uploads_status_idx ON kodiak_music_uploads (status, created_at DESC);

CREATE TABLE IF NOT EXISTS kodiak_music_song_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id text NOT NULL,
  title text NOT NULL,
  normalized_title text NOT NULL,
  artist_name text NOT NULL DEFAULT '',
  normalized_artist_name text NOT NULL DEFAULT '',
  reference_url text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs-info', 'added')),
  moderator_user_id text NOT NULL DEFAULT '',
  moderator_note text NOT NULL DEFAULT '',
  linked_track_id uuid REFERENCES kodiak_music_tracks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kodiak_music_song_requests_status_idx ON kodiak_music_song_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS kodiak_music_song_requests_requester_idx ON kodiak_music_song_requests (requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kodiak_music_song_requests_search_idx ON kodiak_music_song_requests USING gin(
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(artist_name, ''))
);

CREATE TABLE IF NOT EXISTS kodiak_music_lounge_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL DEFAULT 'library' CHECK (source_kind IN ('library', 'youtube', 'external', 'request')),
  track_id uuid REFERENCES kodiak_music_tracks(id) ON DELETE SET NULL,
  title text NOT NULL,
  artist_name text NOT NULL DEFAULT '',
  reference_url text NOT NULL DEFAULT '',
  added_by_user_id text NOT NULL,
  played_at timestamptz,
  played_by_user_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kodiak_music_lounge_queue_created_at_idx ON kodiak_music_lounge_queue (created_at DESC);
CREATE INDEX IF NOT EXISTS kodiak_music_lounge_queue_track_idx ON kodiak_music_lounge_queue (track_id);

CREATE TABLE IF NOT EXISTS kodiak_music_lounge_votes (
  queue_item_id uuid NOT NULL REFERENCES kodiak_music_lounge_queue(id) ON DELETE CASCADE,
  voter_user_id text NOT NULL,
  vote text NOT NULL CHECK (vote IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_item_id, voter_user_id)
);
