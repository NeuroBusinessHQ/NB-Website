-- ============================================================
-- NeuroBusiness™ AI — Tester Profile Insert
-- Ausführen im Supabase SQL Editor:
-- https://supabase.com/dashboard/project/psqfrdpitjmfwvupmfdp/editor
--
-- E-Mails anpassen, dann ausführen.
-- Danach können sich alle über den Login-Screen einloggen.
--
-- HINWEIS: email hat keinen UNIQUE-Constraint → INSERT mit WHERE NOT EXISTS
-- Zum Aktualisieren bestehender Profile: UPDATE direkt per Email verwenden.
-- ============================================================

-- Neue Profile einfügen (nur wenn Email noch nicht vorhanden)
INSERT INTO profiles (email, first_name)
SELECT v.email, v.first_name
FROM (VALUES
  ('evaa.com@gmail.com',        'Eva'),
  ('elan.kolontaiu@gmail.com',  'Elan'),
  ('jkjazz19@yahoo.co.uk',      'Tester'),
  ('oliveri.jerome@gmail.com',  'Jerome'),
  ('mark.gregg@bonago.de',      'Mark')
) AS v(email, first_name)
WHERE NOT EXISTS (
  SELECT 1 FROM profiles p WHERE p.email = v.email
);

-- Namen aktualisieren (falls Profile bereits existieren)
-- UPDATE profiles SET first_name = 'Eva'    WHERE email = 'evaa.com@gmail.com';
-- UPDATE profiles SET first_name = 'Elan'   WHERE email = 'elan.kolontaiu@gmail.com';
-- UPDATE profiles SET first_name = 'Tester' WHERE email = 'jkjazz19@yahoo.co.uk';
-- UPDATE profiles SET first_name = 'Jerome' WHERE email = 'oliveri.jerome@gmail.com';
