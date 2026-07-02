-- Team Intelligence (B2B) — Teams + Team-Zuordnung auf Profilen
-- Ausführen im Supabase SQL Editor

CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,          -- z.B. "ACME24" — kommt in den Diagnostik-Link (?team=ACME24)
  owner_key   TEXT NOT NULL,                 -- Zugangsschlüssel für das Team-Dashboard (nur an Käufer geben)
  name        TEXT NOT NULL,
  owner_email TEXT,
  seats       SMALLINT DEFAULT 10,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_code TEXT;
CREATE INDEX IF NOT EXISTS idx_profiles_team ON profiles(team_code);

-- RLS: Zugriff ausschließlich über den Worker (Service Role) — kein direkter Client-Zugriff
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
