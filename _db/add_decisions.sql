-- ============================================================
-- Decision Log — Migration
-- Entscheidungen der Nutzer: Typ × Entscheidung × Alignment.
-- Wird zu einem der wertvollsten Datensätze (Entscheidungsmuster pro Psychotyp).
-- In Supabase SQL Editor ausführen.
-- ============================================================

CREATE TABLE IF NOT EXISTS decisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  note        TEXT,
  aligned     TEXT DEFAULT 'unsure' CHECK (aligned IN ('yes','no','unsure')),
  energy_at   SMALLINT,          -- Energie-Level (1-4) zum Zeitpunkt der Entscheidung
  status      TEXT DEFAULT 'open',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decisions_user ON decisions(user_id, created_at DESC);

-- RLS aktivieren — Zugriff läuft ausschließlich über den Worker (Service Key)
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
