-- ═══════════════════════════════════════════════════════════════
-- NeuroBusiness™ Consent-Schema Migration
-- Datum: 2026-06-22
-- Reihenfolge: erst dieses Script, DANN drop_user_id_diagnostic_responses.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. user_id aus diagnostic_responses entfernen (anonym bleiben) ──
alter table diagnostic_responses drop column if exists user_id;

-- ── 2. Neue Spalten für diagnostic_responses (Topf 2 — Forschung) ──
alter table diagnostic_responses
  add column if not exists consent_research_version text,
  -- z.B. "v1.0_2026-06" — Versionsnachweis des Einwilligungstextes
  -- Wichtig: Falls der Einwilligungstext sich ändert, erhöhst du die Version.
  -- So kannst du nachweisen, welchem Text ein Nutzer zugestimmt hat.
  add column if not exists consent_source text;
  -- "solo_direct" | "coach_credit" | "tally"
  -- Herkunft des Datensatzes — für spätere Methodenberichte

-- ── 3. DSGVO-Consent-Nachweis in profiles (Topf 1 — Geschäft) ──
-- Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)
-- + Nachweis der informierten Einwilligung bei Teststart
alter table profiles
  add column if not exists consent_dsgvo          boolean     not null default false,
  add column if not exists consent_timestamp      timestamptz,
  add column if not exists consent_source         text;
  -- consent_dsgvo: true = Nutzer hat DSGVO-Pflicht-Checkbox aktiviert
  -- consent_timestamp: Zeitpunkt der Einwilligung (UTC)
  -- consent_source: "solo_direct" | "coach_credit" | "tally"

-- ── 4. Anonymisierter Forschungs-View (nur Einwilligungs-Datensätze) ──
-- Dieser View ist dein sauberer Forschungs-Pool.
-- Er enthält KEINE personenbezogenen Felder.
-- Vor Nutzung für Forschung: rechtliche Prüfung sicherstellen.
create or replace view v_research_dataset as
select
  id,
  created_at,
  q1,  q2,  q3,  q4,  q5,
  q6,  q7,  q8,  q9,  q10,
  q11, q12, q13, q14, q15,
  q16, q17, q18, q19, q20,
  q21, q22, q23, q24, q25,
  q26, q27, q28, q29, q30,
  q31, q32, q33, q34, q35,
  q36, q37, q38, q39, q40,
  q41, q42, q43, q44, q45,
  q46, q47, q48, q49, q50,
  lang,
  industry,
  years,
  response_set_warning,
  consent_research_version,
  consent_source
from diagnostic_responses
where consent_research = true;

-- Kommentar: Felder die NICHT im View sind (bewusst ausgeschlossen):
-- consent_research (immer true in diesem View, redundant)
-- user_id (existiert nicht mehr — gut so)

-- ── 5. RLS-Check: diagnostic_responses ──
-- Service Role Key (Worker) darf inserten — RLS bypass via apikey.
-- Kein anonymer Lesezugriff. View v_research_dataset erbt diese Policy.
-- Falls du RLS-Policies brauchst zum Prüfen:
-- select * from pg_policies where tablename = 'diagnostic_responses';
