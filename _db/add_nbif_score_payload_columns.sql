-- ============================================================================
-- NeuroBusiness NBIF — Add validation score payload columns
-- ----------------------------------------------------------------------------
-- Run this once in Supabase SQL Editor before collecting further NBIF 1.1 data.
-- It aligns nbif_scores with workers/ai.js, which writes subscale and full score
-- payload JSON for reproducible validation exports.
-- ============================================================================

alter table public.nbif_scores
  add column if not exists subscales_json jsonb,
  add column if not exists score_payload_json jsonb;

insert into public.nbif_audit_log (event_type, scoring_version, detail)
values (
  'schema_migration',
  'nbif-1.1-cognitive-pilot-2026-07',
  jsonb_build_object(
    'migration', 'add_nbif_score_payload_columns',
    'tables', jsonb_build_array('nbif_scores'),
    'columns', jsonb_build_array('subscales_json', 'score_payload_json'),
    'reason', 'Align Supabase schema with Worker save-diagnostic payload for NBIF subscales and reproducible score audits.'
  )
);
