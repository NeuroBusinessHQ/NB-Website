-- ============================================================================
-- NeuroBusiness NBIF — Verification after add_nbif_score_payload_columns.sql
-- Run in Supabase SQL Editor after the migration.
-- ============================================================================

-- 1) Confirm the new columns exist.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'nbif_scores'
  and column_name in ('subscales_json', 'score_payload_json')
order by column_name;

-- Expected:
-- score_payload_json | jsonb
-- subscales_json     | jsonb

-- 1b) Confirm consented validation sessions can be linked to profiles.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'nbif_sessions'
  and column_name = 'profile_id';

-- 2) Confirm the audit entry exists.
select event_type, scoring_version, detail, created_at
from public.nbif_audit_log
where event_type = 'schema_migration'
  and scoring_version = 'nbif-1.1-cognitive-pilot-2026-07'
order by created_at desc
limit 5;

-- 3) After one real consented test run, confirm NBIF data landed.
select
  (select count(*) from public.nbif_sessions) as sessions_total,
  (select count(*) from public.nbif_raw_responses) as raw_items_total,
  (select count(*) from public.nbif_scores) as scores_total,
  (select count(*) from public.v_nbif_export) as export_rows_total;

-- 4) Inspect the most recent scored session payload.
select
  s.session_id,
  se.profile_id,
  s.scoring_version,
  s.primary_type,
  s.secondary_type,
  s.burnout_flag,
  jsonb_object_keys(s.subscales_json) as first_subscale_key_sample
from public.nbif_scores s
join public.nbif_sessions se on se.session_id = s.session_id
where s.subscales_json is not null
order by s.computed_at desc
limit 10;
