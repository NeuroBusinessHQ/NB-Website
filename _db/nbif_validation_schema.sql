
-- ============================================================================
-- NBIF — Validierungs-Ready Daten-Architektur (Phase 0.1)
-- ----------------------------------------------------------------------------
-- Ziel: Jeder Testdatensatz ab dem ersten Tester ist sauber für die
--       wissenschaftliche Validierung (N=500, CFA/SEM, IRT) extrahierbar —
--       inkl. Item-Timing, Session-Metadaten, versioniertem Scoring und Audit.
--
-- Grundprinzip: Bei freiwilliger Einwilligung verknuepfbarer Validierungs-Topf.
-- PII bleibt in profiles; nbif_sessions speichert nur profile_id als Support-,
-- Retest- und Widerrufsanker. E-Mail/Name werden nicht in NBIF-Tabellen kopiert.
-- Additiv — bricht keine bestehenden Tabellen (profiles, diagnostic_responses …).
--
-- Ausführen im Supabase SQL Editor (einmalig).
-- ============================================================================

-- 1. nbif_sessions — eine Zeile pro Testdurchlauf ----------------------------
create table if not exists nbif_sessions (
  session_id               uuid primary key default gen_random_uuid(),
  profile_id               uuid references profiles(id) on delete set null,
  participant_pseudonym    text,          -- optionaler stabiler Hash (KEIN Klartext-PII)
  started_at               timestamptz not null,
  completed_at             timestamptz,
  completion_status        text not null default 'started'
                             check (completion_status in ('started','completed','abandoned')),
  duration_ms              integer,        -- Gesamtdauer completed_at - started_at
  device_type              text,           -- 'desktop' | 'mobile' | 'tablet'
  user_agent               text,
  referrer_source          text,           -- document.referrer / utm_source
  lang                     text,           -- 'de' | 'en'
  scoring_version          text not null,  -- z.B. 'nbif-2026-06-efa'
  consent_research         boolean not null default false,
  consent_source           text,           -- 'solo_direct' | 'coach_credit' | 'tally'
  consent_research_version text,           -- z.B. 'v1.0_2026-06'
  response_set_warning     boolean default false,  -- Acquiescence-/Straightlining-Flag
  created_at               timestamptz default now()
);
create index if not exists idx_nbif_sessions_profile on nbif_sessions(profile_id);

-- 2. nbif_raw_responses — LONG-Format: eine Zeile pro Item (50 pro Session) --
--    Diese Struktur ist die saubere Basis für CFA/EFA/IRT + Timing-Analysen.
create table if not exists nbif_raw_responses (
  id               bigint generated always as identity primary key,
  session_id       uuid not null references nbif_sessions(session_id) on delete cascade,
  question_id      smallint not null check (question_id between 1 and 50),
  dimension        text,             -- 'D1'..'D5' (Q1-10=D1, Q11-20=D2, …)
  response_value   smallint not null check (response_value between 1 and 5),
  response_time_ms integer,          -- Bearbeitungszeit für dieses Item (Careless-Responding-Marker)
  answered_at      timestamptz,
  unique (session_id, question_id)
);
create index if not exists idx_nbif_raw_session  on nbif_raw_responses(session_id);
create index if not exists idx_nbif_raw_question on nbif_raw_responses(question_id);

-- 3. nbif_scores — berechnete Dimensions-/Typ-Scores, VERSIONIERT -----------
--    scoring_version macht jede Score-Berechnung reproduzierbar. Bei Formel-
--    Änderung: neue Version + Audit-Eintrag; Alt-Scores bleiben unangetastet.
create table if not exists nbif_scores (
  id              bigint generated always as identity primary key,
  session_id      uuid not null unique references nbif_sessions(session_id) on delete cascade,
  scoring_version text not null,
  d1_score smallint, d2_score smallint, d3_score smallint, d4_score smallint, d5_score smallint,
  s_score  smallint, v_score  smallint, m_score  smallint, c_score  smallint, g_score  smallint,
  primary_type   char(1),
  secondary_type char(1),
  burnout_flag   boolean,
  subscales_json jsonb,
  score_payload_json jsonb,
  computed_at    timestamptz default now()
);

-- 4. nbif_audit_log — Scoring-Formel-Änderungen (Reproduzierbarkeit) --------
create table if not exists nbif_audit_log (
  id              bigint generated always as identity primary key,
  event_type      text not null,     -- 'scoring_version_deployed' | 'norm_recomputed' | 'schema_migration'
  scoring_version text,
  detail          jsonb,
  created_at      timestamptz default now()
);

-- 5. nbif_norm_sample — wachsende Normstichprobe -----------------------------
--    Nur valide, eingewilligte, abgeschlossene Durchläufe ohne Response-Set-Warnung.
--    Sobald N ausreichend ist, werden hieraus EMPIRISCHE Perzentile + Cronbach-α berechnet.
create or replace view nbif_norm_sample as
select sc.d1_score, sc.d2_score, sc.d3_score, sc.d4_score, sc.d5_score,
       sc.s_score,  sc.v_score,  sc.m_score,  sc.c_score,  sc.g_score,
       sc.primary_type, sc.secondary_type, sc.burnout_flag,
       se.lang, se.scoring_version, se.completed_at
from nbif_scores sc
join nbif_sessions se on se.session_id = sc.session_id
where se.consent_research = true
  and se.completion_status = 'completed'
  and coalesce(se.response_set_warning, false) = false;

-- 6. v_nbif_export — flacher Validierungs-Export (Items + Scores) ------------
--    Ziel-Format für CSV/JSON-Export an die Validierungs-Analyse (R/Python/SPSS).
create or replace view v_nbif_export as
select se.session_id, se.lang, se.scoring_version, se.completed_at, se.duration_ms,
       se.device_type, se.consent_source, se.response_set_warning,
       se.profile_id,
       rr.question_id, rr.dimension, rr.response_value, rr.response_time_ms,
       sc.d1_score, sc.d2_score, sc.d3_score, sc.d4_score, sc.d5_score,
       sc.s_score, sc.v_score, sc.m_score, sc.c_score, sc.g_score,
       sc.primary_type, sc.secondary_type, sc.burnout_flag,
       sc.subscales_json, sc.score_payload_json
from nbif_sessions se
join nbif_raw_responses rr on rr.session_id = se.session_id
left join nbif_scores sc on sc.session_id = se.session_id
where se.consent_research = true
  and se.completion_status = 'completed';

-- ── Row Level Security: nur Service-Role (Worker/n8n). Kein anonymer Zugriff ──
alter table nbif_sessions       enable row level security;
alter table nbif_raw_responses  enable row level security;
alter table nbif_scores         enable row level security;
alter table nbif_audit_log      enable row level security;

create policy nbif_sessions_service on nbif_sessions      for all to service_role using (true) with check (true);
create policy nbif_raw_service      on nbif_raw_responses for all to service_role using (true) with check (true);
create policy nbif_scores_service   on nbif_scores        for all to service_role using (true) with check (true);
create policy nbif_audit_service    on nbif_audit_log     for all to service_role using (true) with check (true);

-- ── Initialer Audit-Eintrag: aktuelle Scoring-Version festhalten ──
insert into nbif_audit_log (event_type, scoring_version, detail)
values ('scoring_version_deployed', 'nbif-2026-06-efa',
        '{"note":"Pilot-Scoring-Formel (D4/D5 refactored 2026-06). Quelle: diagnostic.html computeScores.","dims":"D1=Q1-10,D2=Q11-20,D3=Q21-30,D4=Q31-40,D5=Q41-50"}'::jsonb);

insert into nbif_audit_log (event_type, scoring_version, detail)
values ('scoring_version_deployed', 'nbif-1.1-cognitive-pilot-2026-07',
        '{"note":"NBIF 1.1 Cognitive Pilot. Speichert Subscales und vollständigen Score-Payload für reproduzierbare Validierungsaudits.","source":"diagnostic.html computeScores","payload_columns":["subscales_json","score_payload_json"]}'::jsonb);

insert into nbif_audit_log (event_type, scoring_version, detail)
values ('schema_migration', 'nbif-1.1-cognitive-pilot-2026-07',
        '{"migration":"add_nbif_profile_link_for_consented_data","tables":["nbif_sessions"],"columns":["profile_id"],"reason":"Support, Report-Re-Send, Retest und Widerruf bei freiwilliger Datennutzung ermöglichen."}'::jsonb);

-- ============================================================================
-- Fertig. Nächste Schritte (Code, separat):
--   A) diagnostic.html: session_id + Item-Timing + Gerät/Referrer + scoring_version erfassen
--      und an /api/save-diagnostic mitsenden.
--   B) Worker /api/save-diagnostic: zusätzlich in nbif_sessions / nbif_raw_responses /
--      nbif_scores schreiben (bestehender diagnostic_responses-Insert bleibt).
--   C) Export-Job (n8n, geplant): v_nbif_export -> CSV/JSON, sobald N wächst.
-- ============================================================================
