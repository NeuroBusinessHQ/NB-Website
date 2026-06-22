-- Migration: user_id aus diagnostic_responses entfernen
-- Tabelle muss strikt anonym bleiben (Zweck: Forschung, Rechtsgrundlage: Einwilligung)
-- Datum: 2026-06-22

alter table diagnostic_responses drop column if exists user_id;

-- Zur Kontrolle: bestehende RLS-Policies prüfen
-- select * from pg_policies where tablename = 'diagnostic_responses';
