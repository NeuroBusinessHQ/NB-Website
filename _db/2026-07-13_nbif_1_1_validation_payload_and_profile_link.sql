-- NeuroBusiness NBIF 1.1 validation schema patch
-- Date: 2026-07-13
--
-- Purpose:
-- 1) Store the actual subscale/score payload the worker already sends.
-- 2) Keep consented validation sessions linkable to the customer profile, so
--    support, report re-send, retest history and withdrawal can be handled.

alter table public.nbif_scores
  add column if not exists subscales_json jsonb,
  add column if not exists score_payload_json jsonb;

alter table public.nbif_sessions
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_nbif_sessions_profile
  on public.nbif_sessions(profile_id);

insert into public.nbif_audit_log (event_type, scoring_version, detail)
values (
  'schema_migration_deployed',
  'nbif-1.1-cognitive-pilot-2026-07',
  jsonb_build_object(
    'migration', '2026-07-13_nbif_1_1_validation_payload_and_profile_link',
    'tables', jsonb_build_array('nbif_scores', 'nbif_sessions'),
    'columns', jsonb_build_array('subscales_json', 'score_payload_json', 'profile_id'),
    'reason', 'Enable validation exports, support, report re-send, retest history and withdrawal handling for consented customer data.'
  )
);
