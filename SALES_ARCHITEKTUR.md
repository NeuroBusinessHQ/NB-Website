# NeuroBusiness™ — Sales-Architektur 25k/Monat
**Diplom-Psych. Eva Kolontai · neurobusiness.one · Stand Juni 2026**

---

## 1. Das Ziel: 25.000€/Monat in 30–60 Tagen

| Kanal | Ziel-Umsatz | Conversion-Pfad |
|---|---|---|
| High-Ticket 4.990€ | 15.000€ | 3 Abschlüsse/Monat |
| Diagnostik 147€ | 7.350€ | 50 Käufe/Monat |
| Subscription 49€ | 2.450€ | 50 aktive Abos |
| **Total** | **~24.800€** | |

---

## 2. Funnel A — Quiz → 147€ Diagnostik

### Flow
```
10-Fragen Quiz (index.html)
  ↓ Sofort-Ergebnis (Psychotyp-Letter)
  ↓ E-Mail eingeben (Unlock gesperrte Sections)
  ↓ Supabase quiz_leads + Brevo Kontakt
  ↓ n8n Webhook → Brevo 7-Mail Sequenz (14 Tage)
  ↓ CTA → buy.stripe.com/147
  ↓ Stripe Webhook → n8n → Supabase access_token → Magic Link
  ↓ 50-Fragen Diagnostik (diagnostic.html)
  ↓ Vollständiger Bericht (result_v2.html)
  ↓ [+3 Tage] Upsell → 49€/Monat Subscription
```

### Conversion-Annahmen
- Quiz → E-Mail: 40% (Psychotyp-Neugier ist stark)
- E-Mail → 147€ Kauf: 5% (über 14-Tage-Sequenz)
- 147€ → 49€ Abo: 30% (Diagnostik-Nutzer wollen Tiefe)
- Ziel: 1.000 Quiz-Leads/Monat → 40 E-Mails → 2 Käufe → Skalierung durch Content

---

## 3. Funnel B — High-Ticket 4.990€ Transformation

### Zielgruppe
- Coaches + Berater (LinkedIn): suchen nach differenziertem Tool für Klientinnen
- Führungskräfte (LinkedIn): wollen sich selbst besser verstehen
- Psychologen in Praxis: Diagnostik als Zusatzangebot
- HR-Manager: Team-Diagnostik für Bewerbungsgespräche

### 5-Schritte Outreach-System

**Schritt 1: Prospect identifizieren**
- LinkedIn-Suche: "Business Coach", "Führungskräfte-Coach", "Organisationspsychologin"
- Ziel: 10 qualifizierte Prospects/Tag
- Tool: LinkedIn Sales Navigator (oder manuell)

**Schritt 2: Connection Request**
```
Personalisierte Note (max 300 Zeichen):
"Hallo [Name], ich stosse auf Ihr Profil als [Rolle] — 
Ich entwickle ein neuropsychologisches Diagnostik-Tool für 
Coaches. Wäre schön, in Kontakt zu bleiben. Eva"
```

**Schritt 3: DM nach Accept (Tag 2)**
→ Psychotyp-Hook je nach Profil (s. Templates Abschnitt 6)

**Schritt 4: Angebot Klarheitsgespräch (Tag 4)**
```
"Ich biete gerade 3 kostenlose 20-min-Calls für Coaches an, 
die das Tool testen wollen — Zeeg-Link falls Interesse: [link]"
```

**Schritt 5: Discovery-Call → Close**
- 20 Min Diagnostik-Demo (Screen-Share result_v2.html)
- Problemidentifikation: Was fehlt dir in der Klienten-Diagnostik?
- Angebot: 4.990€ NeuroBusiness Transformation (Lizenz + Coaching + Integration)

### Pipeline-Tracking (Airtable: Sales_Pipeline Tabelle)
```
Spalten: Name | LinkedIn-URL | Profession | Status | 
         Connection Sent | DM Sent | Call Booked | Angebot | 
         Closed | Umsatz | Notizen
Status-Werte: prospect → connected → dm_sent → call_booked → 
              angebot_gemacht → closed_won → closed_lost
```

---

## 4. n8n Workflow-Stack — Ist & Soll

### Bestehende Workflows (Ist)

| ID | Name | Status | Funktion |
|---|---|---|---|
| `knyUs6YvXiMB3Fuu` | NeuroBusiness_diagnostik_complete | ✅ aktiv | Nach 50-Fragen: Report-E-Mail |
| `8VJgxDlRujVi919I` | NB 7-Fragen Lead Magnet | ✅ aktiv | **UPDATEN → 10-Fragen** |
| `Ro4dXW05XHBkmALa` | Stripe→Supabase+Magic Link | ✅ aktiv | Zahlung → Zugangsemail |
| `Txlv7Crpx9lBlkxO` | Magic Link | ✅ aktiv | Token-E-Mail |
| `2sCFS064nZO5A76W` | onboarding_AI | ✅ aktiv | AI Onboarding |
| `LQoOrASPsXBg6AMx` | EVA 06_scheduler | ✅ aktiv | Stündlich Airtable→LI/IG/FB |
| `nHInyktkFjykwzQ1` | EVA 01_intake | ✅ aktiv | Content-Intake |
| `ptXxeCthx8RQagXv` | EVA 02_carousel | ✅ aktiv | Karussell-Posts |
| `MEMGHWkvDxGyqHPL` | EVA 03_rewrite | ✅ aktiv | Content-Rewrite |
| `HQTcq67CVlzFsBzt` | EVA 04_imagepost | ✅ aktiv | Bild-Posts |
| `ic6knJYvabACXO55` | EVA 08_foto_pipeline | ✅ aktiv | Drive→Cloudinary→Telegram |
| `OCa6HCdRcHuL5MwA` | EVA 05_translate | ⚠️ inaktiv | Übersetzer |
| `bspFMzZplTEFlEKu` | EVA 07_performance | ⚠️ inaktiv | Performance-Tracking |

### Fehlende Workflows (Soll — zu bauen)

| # | Name | Priorität | Funktion |
|---|---|---|---|
| NEU-1 | **NB Quiz Lead → Brevo Enrollment** | 🔴 HOCH | Webhook → Brevo Sequence |
| NEU-2 | **NB Post-Purchase Upsell** | 🔴 HOCH | 3-Tage nach Kauf → 49€ Abo |
| NEU-3 | **NB Content AI-Generator** | 🟡 MITTEL | Claude → 30 Posts → Airtable |
| NEU-4 | **NB Outreach Tracker** | 🟡 MITTEL | LinkedIn-Status → Airtable |
| UPDATE | **NB 7-Fragen → 10-Fragen** | 🔴 HOCH | Workflow umbenennen + updaten |

---

## 5. Brevo E-Mail Sequenz (14 Tage, 7 Mails)

### Sequenz-Übersicht

| Tag | Betreff | Ziel |
|---|---|---|
| Tag 1 (sofort) | "Dein Psychotyp: [LETTER] — was das wirklich bedeutet" | Onboarding, Vertrauen aufbauen |
| Tag 2 | "Die eine Fähigkeit, die [TYPE]s zum Vorteil wird" | Engagement, Mehrwert |
| Tag 4 | "[NAME], wer bist du wirklich im Business?" | Vertiefung, Neugier |
| Tag 6 | "Das kostet dich deinen Typ — und du merkst es nicht" | Problem-Bewusstsein |
| Tag 9 | "Was [TYPE] wie du in 90 Tagen erreichen kann" | Transformation-Vision |
| Tag 12 | "Ich war skeptisch — bis ich mein Ergebnis bekam" (Social Proof) | Vertrauen, Einwände nehmen |
| Tag 14 | "Letzte Chance: Vollständige Diagnostik für 147€" | Conversion |

→ Vollständige E-Mail-Texte: **siehe BREVO_EMAIL_SEQUENZ.md**

---

## 6. High-Ticket Outreach Templates

### LinkedIn DM — Stratege-Profil ansprechen (Typ S)
```
Betreff: Neuropsychologische Diagnostik für Coaches

Hallo [NAME],

ich sehe in Deinem Profil einen sehr analytischen Ansatz — 
das deckt sich mit dem, was ich als Neuropsychologin als 
"Strategen-Profil" bezeichne: tiefdenkend, systemisch, 
ergebnisorientiert.

Ich entwickle gerade ein Diagnostik-Instrument für Coaches, 
das Klientenprofile auf 5 neuropsychologischen Dimensionen 
kartiert. Die erste Runde läuft — ich suche noch 2-3 Coaches 
für einen kostenlosen Piloten.

Wäre das relevant für Dich?

Eva
```

### LinkedIn DM — Visionär-Profil (Typ V)
```
Hallo [NAME],

Dein Content hat mich sofort angesprochen — Du denkst in 
Möglichkeiten, nicht in Grenzen. Das ist ein neuropsychologisches 
Muster, das ich als "Visionär-Profil" kenne.

Ich entwickle ein Tool, das genau diese Muster diagnostiziert — 
für Coaches, die ihren Klientinnen mehr Tiefe bieten wollen.

Hast Du 20 Minuten für einen schnellen Call?

Eva (Diplom-Psychologin)
```

### LinkedIn DM — Macher-Profil (Typ M)
```
Hallo [NAME],

direkt: Ich entwickle ein neuropsychologisches Diagnostik-Tool 
für Coaches. 5 Dimensionen, wissenschaftlich fundiert, 
sofort einsetzbar.

Du wirkst wie jemand, der Dinge umsetzt statt diskutiert 
("Macher-Profil" in meiner Systematik). Dafür braucht es 
das richtige Instrument.

Kostenloser 20-Min-Pilot-Call — Interesse?

Eva
```

### E-Mail Cold Outreach (Coach / Berater)
```
Betreff: Diagnostik-Tool für Coaches — Pilotangebot

Liebe [NAME],

als Diplom-Psychologin entwickle ich NeuroBusiness™ — 
ein neuropsychologisches Profiling-Instrument für Business-
Coaching und Leadership-Development.

Das Tool kartiert 5 Dimensionen (Sozialstil, Entscheidungsmodus, 
Motivationsrichtung, Arbeitsstil, Resilienz) und gibt Coaches 
einen wissenschaftlich fundierten Einblick in ihr Klientenprofil.

Aktuell suche ich 3 Coaches für einen kostenlosen Piloten 
(20 Min. Demo + Zugang zur Volldiagnostik).

Falls interessiert: [zeeg-link]

Mit freundlichen Grüßen,
Eva Kolontai
Diplom-Psychologin
neurobusiness.one
```

---

## 7. Content-Maschine — EVA 01–08 + AI-Agent

### Bestehende Pipeline (EVA-System)
```
EVA 01_intake     → Content-Idee einreichen (Webhook oder Manual)
EVA 02_carousel   → Karussell-Post generieren
EVA 03_rewrite    → Text mit Claude rewriten/optimieren  
EVA 04_imagepost  → Bild-Post aufbereiten
EVA 05_translate  → DE/EN Übersetzung (⚠️ reaktivieren)
EVA 06_scheduler  → Stündlich: Airtable → LI/IG/FB autoposten
EVA 07_performance → Engagement tracken (⚠️ reaktivieren)
EVA 08_foto_pipeline → Drive → Cloudinary → Patina-Filter → Telegram
```

### Neuer AI-Content-Agent (n8n Workflow NEU-3)
```
Wöchentlicher Trigger (Montags 8:00)
  ↓ Claude-Prompt: "Generiere 10 LinkedIn-Posts für NeuroBusiness™"
    (je 2 pro Psychotyp S/V/M/C/G, aktuelle Woche, spezifische Hooks)
  ↓ Claude AI Proxy (Workflow wBcvScwbB5NwvZiN)
  ↓ JSON-Response parsen (hook, body, cta, platform)
  ↓ Airtable Batch-Insert → Content_Items (Status: 'draft')
  ↓ Telegram: "✅ 10 neue Post-Drafts in Airtable bereit"
  [Eva reviewed in Airtable → Status: 'scheduled' → EVA 06 postet]
```

### Content-Strategie (30 Tage)
- **Woche 1:** Awareness — "Kenne deinen Typ" Hooks (Quiz-Traffic)
- **Woche 2:** Education — neuropsychologische Konzepte vereinfacht
- **Woche 3:** Social Proof — Mini-Testimonials + Ergebnisse
- **Woche 4:** Offer — direkter CTA zur Diagnostik

---

## 8. Metriken & Weekly Review

### KPIs (wöchentlich tracken)
| Metrik | Ziel/Woche | Wo tracken |
|---|---|---|
| Quiz-Completions | 250 | Supabase quiz_leads |
| E-Mail-Opt-ins | 100 | Brevo Kontaktliste |
| Brevo Open Rate | >40% | Brevo Dashboard |
| Brevo Click Rate | >8% | Brevo Dashboard |
| 147€ Käufe | 12 | Stripe Dashboard |
| LI Connection Requests | 50 | Airtable Sales_Pipeline |
| LI DMs sent | 20 | Airtable Sales_Pipeline |
| Discovery Calls | 3 | Zeeg / Kalender |
| High-Ticket Closes | 0.75 | Airtable Sales_Pipeline |
| Content Posts | 7 | EVA 07_performance |

### Weekly Review Checklist (jeden Montag 30 Min)
1. Brevo: Sequenz-Performance ansehen (Öffnungen, Klicks, Abmeldungen)
2. Airtable Sales_Pipeline: Pipeline-Status updaten
3. LinkedIn: Connection-Requests + DMs beantworten
4. Content: 10 neue AI-Draft-Posts reviewen und auf 'scheduled' setzen
5. Stripe: Wochenumsatz prüfen
6. Anpassung: Was hat funktioniert? Was anpassen?

---

## 9. 30-Tage Aktionsplan

| Woche | Priorität | Ziel |
|---|---|---|
| **Woche 1** | n8n Nurture-Workflow live | Quiz-Leads bekommen automatisch Mails |
| **Woche 1** | 50 LinkedIn-Prospects | Pipeline aufbauen |
| **Woche 2** | 10 DMs gesendet | Erste Discovery-Calls buchen |
| **Woche 2** | Content-AI-Agent live | Wöchentlich 10 Posts auto-generiert |
| **Woche 3** | Erster High-Ticket-Close | 4.990€ Umsatz |
| **Woche 3** | Brevo-Sequenz optimieren | Open Rate > 40% |
| **Woche 4** | 25k/Monat Lauf | Umsatz-Review + Skalierung |

---

## 10. Technische Sofort-Maßnahmen

### Jetzt sofort erledigen:
1. **n8n:** "7-Fragen Lead Magnet" Workflow → MCP aktivieren → auf 10-Fragen updaten
2. **n8n:** "diagnostik_complete" Workflow → MCP aktivieren → Post-Purchase Sequenz hinzufügen
3. **Brevo:** 7-Mail Sequenz in Brevo anlegen (Texte stehen in BREVO_EMAIL_SEQUENZ.md)
4. **n8n:** NEU-1 Workflow "Quiz Lead → Brevo" deployen (JSON in N8N_NURTURE_WORKFLOW.json)
5. **Airtable:** Sales_Pipeline Tabelle in bestehender Base anlegen
6. **LinkedIn:** Profil optimieren → "Diplom-Psychologin | NeuroBusiness™" in Headline

### Hinweis — MCP-Zugang aktivieren:
Für die zwei NeuroBusiness-Workflows, die noch nicht über den AI-Agenten zugänglich sind:
→ In n8n öffnen → Workflow-Einstellungen → "In MCP verfügbar" aktivieren:
- `NeuroBusiness — 7-Fragen Lead Magnet` (ID: 8VJgxDlRujVi919I)  
- `NeuroBusiness_diagnostik_complete` (ID: knyUs6YvXiMB3Fuu)
