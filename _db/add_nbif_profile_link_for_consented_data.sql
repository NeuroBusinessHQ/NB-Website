-- ============================================================================
-- NeuroBusiness NBIF — Link consented validation sessions to profiles
-- ----------------------------------------------------------------------------
-- Run after add_nbif_score_payload_columns.sql.
-- Purpose: Research/validation data should be usable for support, retest,
-- withdrawal, and report re-send workflows when the participant consented.
-- ============================================================================

alter table public.nbif_sessions
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_nbif_sessions_profile
  on public.nbif_sessions(profile_id);

insert into public.nbif_audit_log (event_type, scoring_version, detail)
values (
  'schema_migration',
  'nbif-1.1-cognitive-pilot-2026-07',
  jsonb_build_object(
    'migration', 'add_nbif_profile_link_for_consented_data',
    'tables', jsonb_build_array('nbif_sessions'),
    'columns', jsonb_build_array('profile_id'),
    'reason', 'Keep consented validation sessions linked to the customer profile for support, re-send, retest, and withdrawal workflows.'
  )
);
