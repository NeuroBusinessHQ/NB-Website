-- ============================================================
-- NeuroBusiness™ — RLS aktivieren (Supabase SQL Editor)
-- Einmalig ausführen um alle Tabellen zu schützen.
-- Der Cloudflare Worker nutzt service_role → umgeht RLS → bleibt funktionsfähig.
-- Frontend nutzt anon-Key → nur explizit erlaubte Reads möglich.
-- ============================================================

-- 1. RLS auf allen Tabellen aktivieren
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_tokens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaches           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions     ENABLE ROW LEVEL SECURITY;

-- 2. Alle bestehenden anon-Policies entfernen (sauberer Start)
DROP POLICY IF EXISTS "anon_read_profiles"       ON profiles;
DROP POLICY IF EXISTS "anon_read_access_tokens"  ON access_tokens;

-- 3. Tabellen die NUR der Worker braucht → kein anon-Zugriff
--    (Worker nutzt service_role, umgeht RLS automatisch)
--    Keine Policies nötig → alles gesperrt für anon.

-- 4. Frontend ruft Supabase nicht mehr direkt auf → alle anon-Policies entfernen
DROP POLICY IF EXISTS "anon_read_access_tokens" ON access_tokens;
DROP POLICY IF EXISTS "anon_read_profiles"      ON profiles;

-- Alle Tabellen sind jetzt vollständig gesperrt für anon.
-- Nur der Cloudflare Worker (service_role) hat Zugriff.

-- ============================================================
-- Nach Ausführung testen (im Browser-Dev-Tools oder hier):
-- fetch('https://psqfrdpitjmfwvupmfdp.supabase.co/rest/v1/profiles?select=*', {headers:{'apikey':'ANON_KEY'}})
-- → sollte [] zurückgeben (RLS blockiert alles)
-- ============================================================
