# NBIF 1.1 Item- und Daten-Audit

Datum: 2026-07-13  
Scope: Aktuelle 50-Fragen-Diagnostik in `diagnostic.html`, Worker `/api/save-diagnostic`, Supabase NBIF-Validierungstabellen.

## Entscheidung

Die aktuelle 50-Fragen-Version bleibt als bezahlbare Pilot-Version bestehen.

Kommunikation:

- Produktname: NeuroBusiness Full Diagnostic
- Instrumentversion: NBIF 1.1 Cognitive Pilot
- Ergebnisbegriff: dominantes Arbeitsmuster / Business-Arbeitsprofil
- Nicht verwenden: validierte Typklasse, Gehirnstruktur, klinische Diagnose, objektive Kompetenzmessung

## Sofort erledigt

- `nbif_scores` um `subscales_json` und `score_payload_json` ergänzt.
- `nbif_sessions` um `profile_id` ergänzt, damit freiwillig freigegebene Validierungsdaten für Support, erneuten Report-Versand, Retest und Widerruf zuordenbar bleiben.
- Additive Supabase-Migration angelegt: `_db/add_nbif_score_payload_columns.sql`.
- Basisschema `_db/nbif_validation_schema.sql` aktualisiert.
- `v_nbif_export` exportiert die neuen JSON-Felder.
- Öffentliche und Report-Claims abgeschwächt:
  - "Gehirn/brain" weitgehend zu Arbeitsweise / way of working.
  - "Burnout-Risiko" an zentralen Stellen zu Überlastungsindikator.
  - "neuropsychologischer Test" zu psychologisch fundierter Business-Diagnostik.
  - "wissenschaftlich fundiert/validiert" zu Pilot-/Validierungsprozess-kompatibler Sprache.

## Fachliches Audit der 50 Fragen

### Was tragfähig ist

- Die 50 Fragen bilden bereits fünf kontinuierliche Arbeitsdimensionen ab.
- Der Score ist nicht mehr nur Typenlogik, sondern enthält D1-D5, Subscales, Rohantworten, Item-Timing und Scoring-Version.
- Die Trennung zwischen Profilhypothese und Belastungsindikator ist im Code angelegt.
- Die Datenarchitektur ist grundsätzlich validierungsfähig, wenn die NBIF-Tabellen in Supabase live sind.
- Die neue NBIF-Architektur ist nicht mehr vollständig anonym: Bei freiwilliger Datennutzungs-Einwilligung wird die Session mit `profiles.id` verknüpft.

### Was nicht final ist

- Die Typen S/V/M/C/G sind abgeleitete Profilhypothesen, keine empirisch bestätigten Klassen.
- D5 ist Belastung/Vulnerabilität, nicht Burnout-Diagnostik.
- G/High Performer ist aktuell zu stark mit Belastung, Perfektionismus und Absicherung vermischt.
- Connector ist noch zu schmal: Austausch/Gruppenenergie statt Beziehung, Vertrauen, Netzwerk, Konfliktklärung, Stakeholder-Koordination.
- Builder/Macher sollte später klarer getrennt werden:
  - Builder: Systeme, Prozesse, Skalierung, Delegation, Qualität.
  - Macher/High Performer: Tempo, Entscheidung, Ergebnisdruck, Umsetzungsenergie.

## Produktstrategie für erste bezahlte Kunden

Jetzt verkaufen, aber ehrlich rahmen:

- "Pilotierte Business-Diagnostik im wissenschaftlichen Validierungsprozess"
- "Arbeitsmuster und konkrete Umsetzungsempfehlungen"
- "Kein klinischer Test, keine medizinische Diagnose"
- "Report als Hypothese und Arbeitsgrundlage"

Stark verkaufen darfst du:

- klare Business-Übersetzung
- Aufgaben-, Sichtbarkeits-, KI- und Arbeitsdesign-Empfehlungen
- Team-/Coach-Nutzen
- Re-Check und Fortschrittsmessung

Nicht stark claimen:

- "validiert"
- "misst Gehirnstruktur"
- "Burnout-Diagnose"
- "objektive Kompetenzmessung"
- "besser als Big Five"

## Nächste technische Schritte

1. In Supabase ausführen:
   `_db/add_nbif_score_payload_columns.sql`
2. Einen echten Testdurchlauf mit freiwilligem Research-Consent machen.
3. In Supabase prüfen:
   - `nbif_sessions`: 1 neue Session
   - `nbif_raw_responses`: 50 neue Item-Zeilen
   - `nbif_sessions`: `profile_id` ist für den Testkunden gesetzt
   - `nbif_scores`: 1 neue Score-Zeile mit `subscales_json` und `score_payload_json`
   - `v_nbif_export`: 50 Exportzeilen für die Session
4. Wenn das funktioniert, ab diesem Stand keine stillen Frage- oder Scoring-Änderungen mehr ohne neue `SCORING_VERSION`.

## Nächste fachliche Schritte

1. Item-Dokumentation Q1-Q50 erstellen:
   - Wortlaut DE/EN
   - Dimension
   - Subscale
   - intendierter Mechanismus
   - Stärke/Risiko/Zustand/Kontext
   - mögliche Big-Five-/Regulatory-Focus-Bezüge
   - behalten / überarbeiten / später ergänzen
2. Kognitive Pretests mit 10-20 Personen.
3. Pilot 1 mit mindestens 150 Personen, besser 200-250.
4. Vergleichsskalen auswählen:
   - kurze Big-Five-Skala
   - berufliche Selbstwirksamkeit oder Rollenklarheit
   - Erschöpfung/Belastung als separates Kriterium
5. Danach Itemanalyse, Omega/Alpha, explorative Faktorenanalyse.
