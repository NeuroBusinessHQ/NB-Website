-- Practitioner-Portal — Credits, Klienten-Zuordnung, Transaktionen
-- Im Supabase SQL Editor ausführen.

ALTER TABLE coaches ADD COLUMN IF NOT EXISTS credits INT DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS coach_id UUID;
CREATE INDEX IF NOT EXISTS idx_profiles_coach ON profiles(coach_id);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id       UUID NOT NULL,
  delta          INT NOT NULL,              -- +N Kauf, -1 Einladung, +1 Rückgabe
  reason         TEXT,
  stripe_session TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_coach ON credit_transactions(coach_id, created_at DESC);
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Atomare Credit-Buchung: NULL zurück = nicht genug Credits (kein Abzug erfolgt)
CREATE OR REPLACE FUNCTION add_coach_credits(p_coach UUID, p_delta INT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE new_balance INT;
BEGIN
  UPDATE coaches SET credits = COALESCE(credits, 0) + p_delta
  WHERE id = p_coach AND COALESCE(credits, 0) + p_delta >= 0
  RETURNING credits INTO new_balance;
  RETURN new_balance;
END $$;

NOTIFY pgrst, 'reload schema';
