# Consent-Setup — NeuroBusiness™ Diagnostik
## Stack: diagnostic.html → Cloudflare Worker → Supabase

---

## Was bereits implementiert ist (kein Handlungsbedarf im Code)

**diagnostic.html — Intro-Screen vor Frage 1:**
- Checkbox 1 (DSGVO, Pflicht): Start-Button bleibt gesperrt bis gesetzt
- Checkbox 2 (Forschung, freiwillig): default leer, unabhängig wählbar
- `consentDsgvo`, `consentResearch`, `consentTimestamp`, `consentSource` werden beim Klick auf "Start" erfasst und mit dem Ergebnis an den Worker gesendet

**Cloudflare Worker `/api/save-diagnostic`:**
- Topf 1 → `profiles`: speichert `consent_dsgvo`, `consent_timestamp`, `consent_source`
- Topf 2 → `diagnostic_responses`: schreibt nur bei `consentResearch = true`, anonym, mit `consent_research_version` + `consent_source`

**n8n wird NICHT für Consent-Daten genutzt.**
n8n-Webhook `diagnostic-complete` wird nur für den Report-E-Mail-Versand ausgelöst — keine Consent-Felder dort nötig.

---

## Was du noch manuell tun musst

### 1 · Supabase — SQL ausführen
→ Supabase Dashboard → SQL Editor → Inhalt von `_db/migration_consent_schema.sql` einfügen und ausführen.

Das Script erledigt alles in einem Schritt:
- `user_id` aus `diagnostic_responses` entfernen
- Neue Spalten in `diagnostic_responses`: `consent_research_version`, `consent_source`
- Neue Spalten in `profiles`: `consent_dsgvo`, `consent_timestamp`, `consent_source`
- View `v_research_dataset` anlegen (nur Rows mit `consent_research = true`, keine personenbezogenen Felder)

Zur Kontrolle danach:
```sql
select column_name from information_schema.columns where table_name = 'diagnostic_responses';
select column_name from information_schema.columns where table_name = 'profiles';
select count(*) from v_research_dataset;
```

### 2 · Cloudflare Worker deployen
Wrangler ist installiert, braucht nur deinen API-Token:

```bash
# Token erstellen: https://dash.cloudflare.com/profile/api-tokens
# Berechtigung: "Edit Cloudflare Workers"

cd /pfad/zu/workers
CLOUDFLARE_API_TOKEN=dein_token npx wrangler deploy
```

Oder manuell: Cloudflare Dashboard → Workers & Pages → neurobusiness-ai-worker → Edit Code → `ai.js` einfügen → Deploy.

### 3 · Coach-Credit-Links (falls genutzt)
Damit `consent_source` automatisch befüllt wird, Coach-Links mit URL-Parameter versenden:

```
https://neurobusiness.one/diagnostic.html?token=XXX&source=coach_credit&coach_id=YYY
```

Direkt-Links (Solo-Kauf) brauchen keinen Parameter — `source` fällt automatisch auf `solo_direct`.

---

## Widerruf der Forschungseinwilligung

Nutzer schreibt an hello@germaninstitute.eu → du führst in Supabase aus:

```sql
-- Consent-Flag in profiles zurücksetzen (Nachweis des Widerrufs)
update profiles
set consent_dsgvo = false
where email = 'nutzer@example.com';
```

Der anonyme Row in `diagnostic_responses` kann nicht gelöscht werden (kein user_id vorhanden — das ist gewollt und so in der Datenschutzerklärung kommuniziert). Er fällt aber automatisch aus dem View `v_research_dataset` wenn `consent_research = false` gesetzt würde — aber da er anonym ist, ist er ohnehin nicht mehr identifizierbar.

---

## Forschungs-Einwilligungsversion erhöhen

Wenn du den Einwilligungstext änderst:
1. In `diagnostic.html` → `startQuiz()` → `consentResearchVersion: 'v1.0_2026-06'` anpassen
2. In `workers/ai.js` → Fallback-String `'v1.0_2026-06'` anpassen

Dann weißt du für jeden Datensatz in `diagnostic_responses`, welchem Text der Nutzer zugestimmt hat.

---

## Rechtliches

- [ ] Einwilligungstexte (Datenschutzerklärung Abschnitt 6c) von Datenschutzfachperson prüfen lassen
- [ ] Vor Auswertung der Forschungsdaten: Ethikvotum der betreuenden Universität einholen
