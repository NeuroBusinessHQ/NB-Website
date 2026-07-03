-- Sales-Cockpit — LinkedIn-Pipeline für Practitioner-/Team-Akquise
-- Im Supabase SQL Editor ausführen.

CREATE TABLE IF NOT EXISTS sales_prospects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  linkedin_url       TEXT,
  role               TEXT,                          -- Coach / HR / Führungskraft / ...
  company            TEXT,
  type_guess         TEXT,                          -- S/V/M/C/G (Vermutung aus Profil)
  target             TEXT DEFAULT 'practitioner',   -- practitioner | team | core
  status             TEXT DEFAULT 'neu',            -- neu → angefragt → connected → dm → call → angebot → gewonnen/verloren
  notes              TEXT,
  generated_messages JSONB,
  next_action_at     DATE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales_prospects(status, next_action_at);
ALTER TABLE sales_prospects ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
