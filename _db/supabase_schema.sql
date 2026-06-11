-- ============================================================
-- Neurobusiness App — Supabase Schema (v2, passt zu app.html)
-- Ausführen im Supabase SQL Editor (einmalig / bei Update)
-- ============================================================

-- 1. profiles: Käufer-Profil (wird via Stripe-Webhook in n8n befüllt)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT UNIQUE NOT NULL,
  first_name          TEXT,
  lang                TEXT DEFAULT 'de',           -- 'de' | 'en'
  psychotype          TEXT,                         -- 'S' | 'V' | 'M' | 'C' | 'G'
  score_s             SMALLINT DEFAULT 0,
  score_v             SMALLINT DEFAULT 0,
  score_m             SMALLINT DEFAULT 0,
  score_c             SMALLINT DEFAULT 0,
  score_g             SMALLINT DEFAULT 0,
  burnout_alert       BOOLEAN DEFAULT FALSE,
  stripe_customer_id  TEXT UNIQUE,
  stripe_session_id   TEXT UNIQUE,
  product_type        TEXT,                         -- 'solo' | 'companion' | 'diagnostik'
  active              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 2. access_tokens: Magic-Link Tokens (7 Tage gültig)
-- ============================================================
CREATE TABLE IF NOT EXISTS access_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token       TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. conversations: AI Coaching Sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic       TEXT DEFAULT 'general',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 4. messages: Chat-Nachrichten pro Conversation
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 5. checkins: Tägliche Energie/Stress/Fokus Check-ins
-- ============================================================
CREATE TABLE IF NOT EXISTS checkins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  energy_level  SMALLINT,
  stress_level  SMALLINT,
  focus_level   SMALLINT,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Hilfs-Trigger: updated_at automatisch setzen
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins       ENABLE ROW LEVEL SECURITY;

-- Service-Role (n8n Backend): Vollzugriff auf alles
CREATE POLICY "service_role_all_profiles"      ON profiles       FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_tokens"        ON access_tokens  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_conversations" ON conversations  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_messages"      ON messages       FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_checkins"      ON checkins       FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon-Key (Frontend app.html): Token lesen + Profile lesen + App-Daten schreiben

-- Token lesen (nur gültige, nicht abgelaufene)
CREATE POLICY "anon_read_token"
  ON access_tokens FOR SELECT TO anon
  USING (expires_at > NOW());

-- Profile lesen (nur aktive)
CREATE POLICY "anon_read_active_profile"
  ON profiles FOR SELECT TO anon
  USING (active = true);

-- Conversations anlegen und lesen (user_id = eigene)
CREATE POLICY "anon_insert_conversation"
  ON conversations FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_read_conversation"
  ON conversations FOR SELECT TO anon USING (true);

-- Messages anlegen
CREATE POLICY "anon_insert_message"
  ON messages FOR INSERT TO anon WITH CHECK (true);

-- Checkins anlegen und updaten
CREATE POLICY "anon_insert_checkin"
  ON checkins FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update_checkin"
  ON checkins FOR UPDATE TO anon USING (true) WITH CHECK (true);
