# NeuroBusiness™ AI — Cloudflare Setup-Anleitung

> Für Anfänger. Schritt für Schritt. Kein Code-Vorwissen nötig.

---

## Was wir bauen

```
neurobusiness.one            → Cloudflare Pages  (deine HTML-Dateien)
neurobusiness.one/api/ai     → Cloudflare Worker  (sicherer AI-Endpunkt)
psqfrdpitjmfwvupmfdp         → Supabase           (Datenbank)
```

Der Claude API Key liegt **nur** im Cloudflare Worker — niemals im Frontend.

---

## SCHRITT 1 — VS Code Projekt anlegen

1. Lade VS Code herunter: https://code.visualstudio.com
2. Öffne den Ordner `NB Website` in VS Code  
   `File → Open Folder → NB Website auswählen`
3. Deine Struktur sollte so aussehen:
   ```
   NB Website/
   ├── index.html
   ├── app.html
   ├── diagnostic.html
   ├── result_v2.html
   ├── teams.html
   ├── success.html
   ├── cancel.html
   ├── coaches.html
   ├── robots.txt
   ├── sitemap.xml
   ├── og-image.jpg
   ├── supabase_schema.sql
   ├── supabase_migration_v3.sql
   └── workers/
       ├── ai.js          ← Cloudflare Worker
       └── wrangler.toml  ← Worker-Konfiguration
   ```

---

## SCHRITT 2 — GitHub Repo anlegen

1. Gehe zu https://github.com und erstelle ein kostenloses Konto (falls noch keins)
2. Klicke auf **New Repository**
   - Name: `neurobusiness-website`
   - Sichtbarkeit: **Private**
   - Klicke **Create repository**
3. In VS Code: öffne das Terminal (`View → Terminal`)
4. Führe diese Befehle aus (einmalig):
   ```bash
   git init
   git add .
   git commit -m "Initial NeuroBusiness™ AI launch"
   git branch -M main
   git remote add origin https://github.com/DEIN-USERNAME/neurobusiness-website.git
   git push -u origin main
   ```
   > Ersetze `DEIN-USERNAME` mit deinem GitHub-Benutzernamen

---

## SCHRITT 3 — Supabase SQL Migration ausführen

1. Gehe zu https://app.supabase.com → dein Projekt
2. Klicke links auf **SQL Editor**
3. Kopiere den Inhalt von `supabase_migration_v3.sql` in den Editor
4. Klicke **Run**
5. ✓ Du solltest sehen: "Success. No rows returned"

---

## SCHRITT 4 — Cloudflare Pages einrichten (für die Website)

1. Gehe zu https://dash.cloudflare.com → **Pages**
2. Klicke **Create a project → Connect to Git**
3. Verbinde dein GitHub-Konto → wähle `neurobusiness-website`
4. Build-Einstellungen:
   - **Framework preset**: None
   - **Build command**: *(leer lassen)*
   - **Build output directory**: `/` *(oder leer lassen)*
5. Klicke **Save and Deploy**
6. Nach ~1 Minute ist deine Seite live auf einer `*.pages.dev`-URL

---

## SCHRITT 5 — Domain neurobusiness.one verbinden

1. In Cloudflare Pages → dein Projekt → **Custom domains**
2. Klicke **Set up a custom domain**
3. Eingabe: `neurobusiness.one`
4. Folge den Anweisungen (falls die Domain schon bei Cloudflare ist, geht das automatisch)
5. Für `www.neurobusiness.one` dasselbe wiederholen

---

## SCHRITT 6 — Cloudflare Worker einrichten (für den sicheren AI-Endpunkt)

### 6a. Wrangler installieren (einmalig)
```bash
npm install -g wrangler
wrangler login
```

### 6b. Worker deployen
```bash
cd workers
wrangler deploy
```

### 6c. Secrets setzen (API Keys — NUR hier, niemals in HTML-Dateien)
```bash
wrangler secret put SUPABASE_URL
# Eingabe wenn gefragt: https://psqfrdpitjmfwvupmfdp.supabase.co

wrangler secret put SUPABASE_SERVICE_KEY
# Eingabe: deinen Supabase SERVICE_ROLE key
# (Supabase → Settings → API → service_role — NICHT den anon key!)

wrangler secret put ANTHROPIC_API_KEY
# Eingabe: deinen Anthropic API Key (sk-ant-...)
```

### 6d. Worker-Route konfigurieren
1. Cloudflare Dashboard → **Workers & Pages → dein Worker**
2. Klicke **Settings → Triggers → Add Route**
3. Route: `neurobusiness.one/api/*`
4. Zone: `neurobusiness.one`
5. Speichern

---

## SCHRITT 7 — Lokales Testen

### Website lokal testen
```bash
# Im NB Website Ordner:
npx serve .
# Öffne http://localhost:3000
```

### Worker lokal testen
```bash
cd workers
wrangler dev
# Worker läuft auf http://localhost:8787
```

Für lokales Testen in app.html:
```javascript
// Temporär für lokalen Test:
const AI_ENDPOINT = 'http://localhost:8787/api/ai';
// Vor dem Deploy wieder auf '/api/ai' setzen!
```

---

## SCHRITT 8 — Alle Secrets im Überblick

| Secret | Wo holen | Wo speichern |
|--------|----------|--------------|
| `SUPABASE_URL` | Supabase → Settings → API | Cloudflare Worker Secret |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role | Cloudflare Worker Secret |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Cloudflare Worker Secret |
| `SUPABASE_KEY` (anon) | Supabase → Settings → API → anon public | In HTML-Dateien (sicher, da nur Leserechte mit RLS) |

> **Goldene Regel**: Alles mit "SECRET" oder "SERVICE" → nur im Cloudflare Worker.  
> Der `anon` Supabase-Key im Frontend ist sicher, solange Row Level Security (RLS) aktiv ist.

---

## SCHRITT 9 — Test-Checkliste vor Launch

### Basics
- [ ] index.html lädt ohne Fehler
- [ ] teams.html lädt ohne Fehler
- [ ] diagnostic.html öffnet mit Token
- [ ] Alle 50 Fragen beantwortbar
- [ ] Ergebnis wird berechnet und zu result_v2.html weitergeleitet
- [ ] Psychotyp, Scores, Burnout-Flag in Supabase gespeichert (in `profiles` Tabelle prüfen)
- [ ] result_v2.html zeigt den richtigen Typ an

### Auth & Zugang
- [ ] Magic-Link-E-Mail wird ausgelöst (n8n)
- [ ] Token-Link öffnet app.html korrekt
- [ ] Abgelaufener Token zeigt Fehlermeldung
- [ ] Falsches Token zeigt Fehlermeldung

### AI Worker
- [ ] POST /api/ai antwortet mit `{"reply": "...", "conversationId": "..."}`
- [ ] Ungültiger Token → 401 Fehler
- [ ] Nachricht wird in Supabase `messages` Tabelle gespeichert
- [ ] Empfehlung wird in `recommendations` Tabelle gespeichert (bei Modi: pricing, offer, etc.)

### App-Funktionen
- [ ] Energie-Check-in wird in `checkins` Tabelle gespeichert
- [ ] "Als Aufgabe speichern" schreibt in `tasks` Tabelle
- [ ] Feedback 👍/👎 schreibt in `feedback` Tabelle
- [ ] Modus-Wechsel (Agenda, Pricing, etc.) funktioniert
- [ ] Wochenagenda lädt (Montag testen)

### DSGVO
- [ ] Datenschutzhinweis im Welcome-Screen sichtbar
- [ ] Löschanfrage-Kontakt (hello@neurobusiness.one) sichtbar

---

## Häufige Fehler

**"Module not found" beim Worker Deploy**  
→ Stelle sicher dass du im `workers/` Ordner bist: `cd workers`

**CORS-Fehler im Browser**  
→ Prüfe `ALLOWED_ORIGIN` in `wrangler.toml` — muss exakt `https://neurobusiness.one` sein

**401 beim API-Aufruf**  
→ Token in app.html wird korrekt übergeben? Prüfe in Browser DevTools → Network → /api/ai Request-Header

**Supabase PATCH schlägt fehl**  
→ RLS-Policy prüfen (Schritt 3). Columns `secondary_psychotype`, `industry`, etc. müssen existieren (Migration v3 ausführen)
