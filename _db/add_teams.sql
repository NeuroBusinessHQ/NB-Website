-- Team Intelligence (B2B) — Teams + Team-Zuordnung auf Profilen
-- BEREITS AUSGEFÜHRT am 02.07.2026 (via Supabase SQL Editor).
-- Hinweis: Es existierte bereits eine ältere teams-Tabelle (id, name, owner_id, created_at).
-- Diese wurde zerstörungsfrei erweitert statt neu angelegt.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_key TEXT;   -- Zugangsschlüssel fürs Team-Dashboard
ALTER TABLE teams ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS seats SMALLINT DEFAULT 10;
ALTER TABLE teams ALTER COLUMN owner_id DROP NOT NULL;       -- Altspalte, wird vom Worker nicht befüllt
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_code ON teams(code);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_code TEXT;
CREATE INDEX IF NOT EXISTS idx_profiles_team ON profiles(team_code);

-- RLS: Zugriff ausschließlich über den Worker (Service Role)
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- PostgREST-Schema-Cache nach Änderungen neu laden:
NOTIFY pgrst, 'reload schema';
