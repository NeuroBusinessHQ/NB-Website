-- ============================================================
-- NeuroBusiness™ AI — Supabase Migration v3
-- Neue Tabellen für lernende AI + erweitertes Datenprofil
-- Ausführen im Supabase SQL Editor (nach v2 Schema)
-- ============================================================

-- ── 0. Fehlende Spalten in profiles ergänzen ──────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS secondary_psychotype TEXT,
  ADD COLUMN IF NOT EXISTS industry             TEXT,
  ADD COLUMN IF NOT EXISTS years_self_employed  TEXT,
  ADD COLUMN IF NOT EXISTS report_context       TEXT,   -- JSON: Zusammenfassung für AI-Kontext
  ADD COLUMN IF NOT EXISTS consent_ai_learning  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_given_at     TIMESTAMPTZ;

-- ── 1. business_profiles ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  current_business_stage   TEXT,   -- 'idea' | 'launch' | 'growing' | 'scaling' | 'pivoting'
  offer_type               TEXT,   -- 'coaching' | 'consulting' | 'done_for_you' | 'course' | 'retainer' | 'mixed'
  target_audience          TEXT,
  revenue_goal             TEXT,   -- z.B. '5000/Monat' oder '60000/Jahr'
  main_problem             TEXT,
  available_hours_per_week SMALLINT,
  visibility_preference    TEXT,   -- 'content' | 'speaking' | 'referral' | 'none' | 'mixed'
  sales_style              TEXT,   -- 'direct' | 'educational' | 'relationship' | 'passive'
  current_monthly_revenue  TEXT,
  biggest_fear             TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_profiles_user ON business_profiles(user_id);

-- ── 2. recommendations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mode                 TEXT NOT NULL,  -- 'chat' | 'agenda' | 'pricing' | 'offer' | 'visibility' | 'decision' | 'burnout' | 'client'
  recommendation_text  TEXT NOT NULL,
  psychotype_context   TEXT,           -- Welcher Typ war aktiv, welche Scores
  conversation_id      UUID REFERENCES conversations(id) ON DELETE SET NULL,
  is_actionable        BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_user ON recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_mode  ON recommendations(mode);

-- ── 3. tasks ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recommendation_id UUID REFERENCES recommendations(id) ON DELETE SET NULL,
  task_text         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','skipped')),
  due_date          DATE,
  week_tag          TEXT,  -- z.B. 'KW24-2026'
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user   ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- ── 4. outcomes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outcomes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id             UUID REFERENCES tasks(id) ON DELETE SET NULL,
  result_type         TEXT NOT NULL CHECK (result_type IN (
                        'clarity','lead','sale','content_created',
                        'no_result','stress_reduced','other'
                      )),
  result_description  TEXT,
  revenue_generated   NUMERIC(10,2),
  confidence_level    SMALLINT CHECK (confidence_level BETWEEN 1 AND 5),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outcomes_user ON outcomes(user_id);

-- ── 5. feedback ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_id            UUID REFERENCES messages(id) ON DELETE SET NULL,
  recommendation_id     UUID REFERENCES recommendations(id) ON DELETE SET NULL,
  helpful_score         SMALLINT CHECK (helpful_score BETWEEN 1 AND 5),
  too_generic           BOOLEAN DEFAULT FALSE,
  too_complex           BOOLEAN DEFAULT FALSE,
  emotionally_accurate  BOOLEAN DEFAULT TRUE,
  implemented           BOOLEAN DEFAULT FALSE,
  comment               TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);

-- ── 6. weekly_reviews ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start            DATE NOT NULL,
  week_tag              TEXT,  -- z.B. 'KW24-2026'
  energy_average        NUMERIC(3,1),
  completed_tasks_count SMALLINT DEFAULT 0,
  skipped_tasks_count   SMALLINT DEFAULT 0,
  main_win              TEXT,
  main_block            TEXT,
  next_focus            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_reviews_user ON weekly_reviews(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_reviews_user_week ON weekly_reviews(user_id, week_start);

-- ── Trigger: updated_at automatisch setzen ────────────────────
DROP TRIGGER IF EXISTS trg_business_profiles_updated_at ON business_profiles;
CREATE TRIGGER trg_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcomes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback          ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reviews    ENABLE ROW LEVEL SECURITY;

-- Service-Role: Vollzugriff (für n8n + Cloudflare Worker mit Service Key)
CREATE POLICY "service_role_all_business_profiles" ON business_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_recommendations"   ON recommendations   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_tasks"             ON tasks             FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_outcomes"          ON outcomes          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_feedback"          ON feedback          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_weekly_reviews"    ON weekly_reviews    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon-Key (Frontend): nur eigene Daten lesen/schreiben
CREATE POLICY "anon_own_business_profiles_read"   ON business_profiles FOR SELECT TO anon USING (true);
CREATE POLICY "anon_own_business_profiles_insert" ON business_profiles FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_own_business_profiles_update" ON business_profiles FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_recommendations_read"         ON recommendations   FOR SELECT TO anon USING (true);
CREATE POLICY "anon_recommendations_insert"       ON recommendations   FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_tasks_all"                    ON tasks             FOR ALL    TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_outcomes_all"                 ON outcomes          FOR ALL    TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_feedback_all"                 ON feedback          FOR ALL    TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_weekly_reviews_all"           ON weekly_reviews    FOR ALL    TO anon USING (true) WITH CHECK (true);

-- ── Anonymisierte Pattern-Analyse View (für AI-Learning) ──────
-- Diese View gibt keine personenbezogenen Daten preis.
CREATE OR REPLACE VIEW v_pattern_insights AS
SELECT
  p.psychotype,
  r.mode,
  AVG(f.helpful_score)::NUMERIC(3,1)          AS avg_helpfulness,
  COUNT(DISTINCT r.id)                          AS total_recommendations,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done')    AS tasks_done,
  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'skipped') AS tasks_skipped,
  COUNT(DISTINCT o.id) FILTER (WHERE o.result_type IN ('lead','sale')) AS commercial_results,
  COUNT(DISTINCT o.id) FILTER (WHERE o.result_type = 'clarity')       AS clarity_results
FROM profiles p
JOIN recommendations r  ON r.user_id = p.id
LEFT JOIN tasks t        ON t.recommendation_id = r.id
LEFT JOIN outcomes o     ON o.task_id = t.id
LEFT JOIN feedback f     ON f.recommendation_id = r.id
WHERE p.consent_ai_learning = TRUE   -- nur mit expliziter Zustimmung
GROUP BY p.psychotype, r.mode;
