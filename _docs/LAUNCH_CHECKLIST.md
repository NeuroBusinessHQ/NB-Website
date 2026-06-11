# NeuroBusiness™ AI — Launch Checklist v2
_Stand: 11.06.2026 — Sicherheits-Update: Claude API Key aus Frontend entfernt_

---

## ✅ Bereits erledigt (automatisch durch dieses Update)

| Was | Datei |
|---|---|
| ✅ Claude/Anthropic API Key aus app.html entfernt — liegt jetzt sicher im Cloudflare Worker | `workers/ai.js` |
| ✅ Alle AI-Anfragen gehen durch sicheren `/api/ai` Endpunkt | `app.html` |
| ✅ Supabase Migration v3 erstellt (6 neue Tabellen für lernende AI) | `supabase_migration_v3.sql` |
| ✅ Diagnostic speichert Scores, Psychotyp, Burnout, Branche, Jahre direkt in Supabase | `diagnostic.html` |
| ✅ Token wird von diagnostic.html an result_v2.html + app.html weitergegeben | `diagnostic.html` |
| ✅ Feedback-Buttons (👍/👎) nach jeder AI-Antwort | `app.html` |
| ✅ "Als Aufgabe speichern" 📌 Button nach jeder AI-Antwort | `app.html` |
| ✅ Recommendations werden für Pricing/Offer/Visibility etc. automatisch gespeichert | `workers/ai.js` |
| ✅ Cloudflare Setup-Anleitung erstellt | `CLOUDFLARE_SETUP.md` |
| ✅ index.html, teams.html, sitemap.xml aktualisiert | — |

---

## 🔴 PRIORITÄT 1 — Sicherheit & Infrastruktur (zuerst!)

### 1a. Supabase Migration v3 ausführen
1. Supabase → SQL Editor
2. Inhalt von `supabase_migration_v3.sql` einfügen → **Run**
3. Prüfen: Neue Tabellen erscheinen: `business_profiles`, `recommendations`, `tasks`, `outcomes`, `feedback`, `weekly_reviews`
4. Spalten in `profiles` prüfen: `secondary_psychotype`, `industry`, `years_self_employed`, `report_context` müssen da sein

### 1b. Cloudflare Worker deployen (KRITISCH — AI funktioniert sonst nicht)
Folge der vollständigen Anleitung in `CLOUDFLARE_SETUP.md`

Kurzfassung:
```bash
npm install -g wrangler
wrangler login
cd workers
wrangler deploy
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY   # Service Role Key, nicht anon!
wrangler secret put ANTHROPIC_API_KEY
```

### 1c. Worker-Route in Cloudflare setzen
- Route: `neurobusiness.one/api/*` → Worker: `neurobusiness-ai-worker`

---

## 🔴 PRIORITÄT 2 — Supabase & n8n

### 2a. n8n Variablen prüfen

| Variable | Wert |
|---|---|
| `SUPABASE_URL` | `https://psqfrdpitjmfwvupmfdp.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Service Role Key aus Supabase Settings → API |
| `APP_URL` | `https://neurobusiness.one` |

### 2b. n8n Workflows aktivieren
- [ ] Magic-Link Workflow aktiv: `https://evakolontai.app.n8n.cloud/webhook/nb-magic-link`
- [ ] Stripe-Onboarding Workflow aktiv: `https://evakolontai.app.n8n.cloud/webhook/nb-stripe`
- [ ] Diagnostic-Complete Workflow aktiv: `https://evakolontai.app.n8n.cloud/webhook/diagnostic-complete`

---

## 🔴 PRIORITÄT 3 — Stripe & Brevo

### 3a. Stripe Webhook
- URL: `https://evakolontai.app.n8n.cloud/webhook/nb-stripe`
- Event: `checkout.session.completed`

### 3b. Brevo Sender verifizieren
- `hello@neurobusiness.one` als Sender bestätigen
- SPF/DKIM DNS-Einträge setzen

### 3c. Stripe Produkte

| Produkt | Preis | Stripe Link |
|---|---|---|
| Solo Diagnostik Report | €97 oder €147? | `buy.stripe.com/5kQfZj1NbbjK50Sg1Basg08` |
| AI Companion | €49/Monat | `buy.stripe.com/eVq7sN77v73u2SKaHhasg06` |
| Transformation | €490 | `buy.stripe.com/6oU9AVfE187yalc6r1asg09` |

---

## 🟡 PRIORITÄT 4 — Datenqualität & DSGVO

### 4a. Consent für AI-Learning einbauen
In `app.html` Welcome-Screen ist bereits ein Datenschutzhinweis.
Für DSGVO-konformes anonymisiertes Lernen muss `consent_ai_learning = true` in `profiles` gesetzt werden.

Empfehlung: Beim ersten App-Login eine kurze Consent-Abfrage zeigen:
> "Darf NeuroBusiness™ deine anonymisierten Muster nutzen, um das System zu verbessern?"
> [Ja, gerne] [Nein danke]

### 4b. Löschfunktion einbauen
Nutzer können unter `hello@neurobusiness.one` Datenlöschung beantragen.
Empfehlung: Später ein `/delete-my-data` Endpunkt im Worker ergänzen.

---

## 🟡 PRIORITÄT 5 — MVP-Features nach Launch

### Phase 2 (nach erstem zahlendem Nutzer)
- [ ] `business_profiles` Formular in app.html einbauen (Business-Kontext erfassen)
- [ ] Weekly Review Funktion (jeden Freitag)
- [ ] Outcomes erfassen: Was hat funktioniert? (nach Task-Erledigung fragen)
- [ ] Pattern-Insights View in Supabase für Eva (welche Empfehlungen wirken pro Typ?)

### Phase 3 (nach 10 Nutzern)
- [ ] NeuroBusiness Transformation Bereich in app.html
- [ ] Gruppenbetreuungs-Funktion
- [ ] Englische Vollversion

---

## 🟢 Test-Reihenfolge vor Launch

1. `app.html?dev=1&type=S&lang=de` → Dev-Modus, kein Token nötig
2. Nachricht senden → Browser DevTools → Network → `/api/ai` prüfen
   - Request: `{messages: [...], mode: "chat"}`
   - Response: `{reply: "...", conversationId: "..."}`
3. Supabase `messages` Tabelle → neue Zeilen erscheinen?
4. Supabase `recommendations` Tabelle → wird befüllt beim Modus `pricing`?
5. Feedback-Button klicken → Supabase `feedback` Tabelle?
6. "Als Aufgabe speichern" → Supabase `tasks` Tabelle?
7. Energie-Check-in → Supabase `checkins` Tabelle?
8. Echten Magic-Link-Flow testen (mit echter E-Mail)

---

## 📋 Was noch offen ist (Kurzfassung)

- [ ] Cloudflare Worker deployen + Secrets setzen (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`)
- [ ] Worker-Route `neurobusiness.one/api/*` in Cloudflare konfigurieren
- [ ] Supabase Migration v3 ausführen
- [ ] n8n Workflows aktiv?
- [ ] Stripe Webhook registriert?
- [ ] Brevo `hello@neurobusiness.one` verifiziert?
- [ ] `og-image.jpg` vorhanden (1200×630px)?
- [ ] Consent-Abfrage für AI-Learning einbauen
