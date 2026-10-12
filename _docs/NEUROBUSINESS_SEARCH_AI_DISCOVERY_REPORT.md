# NEUROBUSINESS SEARCH & AI DISCOVERY REPORT

Stand: 12. Oktober 2026 · Repository: NeuroBusinessHQ/NB-Website · Ausgangscommit: `28a3107` · Arbeitsbranch: `codex/search-ai-discovery`

**Ergebnis:** 21 neue statische Themen-, Wissens- und Unternehmensseiten, vier vorgerenderte bestehende Verkaufsseiten, eine Sitemap mit 25 kanonischen Kernseiten sowie eine getrennte Search-/Training-Crawler-Policy. Bestehende Diagnose-, Zahlungs-, Account- und API-Logik wurde beibehalten. Die Umsetzung ist für Review und Preview vorbereitet; eine Veröffentlichung auf der Produktionsdomain ist nicht Bestandteil des nachgewiesenen Ergebnisses.

**Wichtige Release-Grenze:** Die live ausgelieferte Website enthält bereits Änderungen, die im geklonten `master` fehlen. Dazu gehören SEO-Metadaten, Prerendering, llms.txt und die Route `/practitioner/apply/`. Vor einem Merge mit Produktionswirkung müssen Deployment-Quelle, Build und diese Funnel-Route abgeglichen werden. Ein lokaler Erfolg ist kein Nachweis für den Zustand nach einem Cloudflare-Deployment.

## 1. Gefundene Probleme

### Technischer Discovery-Audit

Der Quellaudit erfasst alle 23 vorhandenen HTML-Dateien. Das maschinenlesbare Inventar enthält Titel, Canonicals, Überschriften, Meta-Tags, Links, Bilder und Vorlagen-Platzhalter. Ergänzend wurden öffentliche Live-URLs per HTTP geprüft.

| Befund | Auswirkung | Behandlung |
|---|---|---|
| Vier zentrale Repository-Seiten verwenden `x-dc` und clientseitige Platzhalter. | Ohne erfolgreiche Runtime kein verlässlicher initialer Kerninhalt. | Vollständige sichtbare statische Snapshots mit anschließendem Laden der Originalkomponente. |
| Live-HTML ist bereits vorgerendert, aber nicht identisch mit `master`. | Ein Deployment aus dem falschen Stand kann bestehende Funktionen verlieren. | Im Bericht und Release-Ablauf ausdrücklich als Abgleich vor Veröffentlichung festgehalten. |
| Unbekannte Live-URL und `/ai-readiness` liefern die Startseite mit HTTP 200. | Soft-404s, falsche URL-Interpretation. | Root-`404.html` ergänzt; neue Themenseiten tatsächlich angelegt. |
| `/solo`, `/teams`, `/coaches` enden live auf `/Solo.dc`, `/Team.dc`, `/Coach.dc`. | Weiterleitungsketten und uneinheitliche öffentliche URLs. | Explizite Worker-Zuordnung; Legacy-Adressen auf kurze Canonicals konsolidiert. |
| www und non-www liefern live beide die Startseite. | Doppelte Hostvarianten. | Öffentliche Hostnormalisierung; Transaktions-/Account-URLs bleiben ausgenommen. |
| Coach-Canonical verwendet im Repository www. | Uneinheitliche Entity- und URL-Signale. | Einheitliche Canonicals unter `https://neurobusiness.one`. |
| Repository-robots erlaubt alles; Live-robots ebenfalls ohne private Ausschlüsse. | Ungeeignete Discovery für interne und personenbezogene Routen. | Private Pfade ausgeschlossen, zusätzlich noindex und interne Datei-Sperren. |
| Repository-Sitemap hat 4, Live-Sitemap 6 URLs einschließlich Quiz und Apply. | Unvollständige Wissensarchitektur; Funnel-Routen werden indexierbar angeboten. | 25 explizite öffentliche Kernseiten; private und Transaktionsseiten ausgeschlossen. |
| Große PNGs, fehlende Bildabmessungen, React/Babel zur Laufzeit. | Potenzielle Ladezeit-/Layoutprobleme. | Abmessungen und Lazy Loading ergänzt; neue Seiten vollständig ohne Runtime. |
| Übersetzungen existieren als UI-Zustand statt separater statischer Sprach-URLs. | Keine verlässlichen hreflang-Alternativen. | Keine erfundenen hreflang-Ziele. Vollständige DE/EN-URL-Strategie bleibt Folgearbeit. |
| Keine zusammenhängende AI-Readiness-/Knowledge-Architektur. | Neue Themen sind schwer auffindbar und nicht klar mit Angeboten verbunden. | Hubs, thematische Links, Methodenregister und passende Kontaktwege. |
| Teilweise starke wissenschaftliche Formulierungen trotz Pilotstatus. | Vertrauens- und Zitierbarkeitsrisiko. | Zentrale Pilotformulierungen präzisiert und Evidenzgrenzen sichtbar gemacht. |

Für Core Web Vitals liegen keine Search-Console-/CrUX-Felddaten vor. Deshalb wird kein bestandener LCP-, INP- oder CLS-Grenzwert behauptet. Die Runtime und große Bestandsbilder bleiben messenswerte Performance-Themen. Die semantische Prüfung umfasst unter anderem H1, Hauptinhalt, Linkziele, Bildattribute und Mobilüberlauf; sie ist keine vollständige WCAG-Zertifizierung.

## 2. Änderungen

- Generierung von rein statischen, direkt lesbaren Knowledge- und Themeninhalten mit einem gemeinsamen responsiven Layout.
- Vorgerenderte Start-, Solo-, Team- und Coach-Seite; Originaltemplates als inerte Vorlagen erhalten. Das statische Dokument bleibt bei blockiertem JavaScript lesbar.
- Bestehende Sprachschalter, Login-Auswahl, Kauf- und Kontaktziele bleiben in der interaktiven Fassung verfügbar.
- Sichtbare Verbindung der Startseite zu AI Readiness, Assessment, Adoption, Enterprise-Vision und Methodik.
- Einheitliche Canonicals, Metadaten und strukturierte Entity-Referenzen für alle 25 Kernseiten.
- Neue Seiten besitzen direkte Antworten, weiterführende Erläuterungen, redaktionelle Verantwortlichkeit und Aktualisierungsdatum.
- Vorhandene alternative Marketingrouten bleiben erreichbar; ihre Canonicals werden konsolidiert. Die dünne Academy-Ankündigung bleibt außerhalb der Sitemap und erhält noindex.
- Interne Quell-, Datenbank-, Dokumentations- und Builddateien werden im Pages-Worker mit 404 beantwortet. Nutzeroberflächen erhalten zusätzlich noindex; bestehende Authentifizierung wird nicht ersetzt.

## 3. Neu erstellte Seiten

### Themen und Angebote

`/ai-readiness`, `/ai-readiness-assessment`, `/ai-adoption`, `/human-ai-transformation`, `/team-intelligence`, `/leadership-intelligence`, `/founder-intelligence`, `/enterprise-ai`.

`/ai-adoption-consulting` verweist per 301 auf `/ai-adoption`. `/ai-transformation` verweist auf `/human-ai-transformation`. Damit werden keine zusätzlichen Seiten mit nahezu identischem Inhalt angelegt.

Die AI-Assessment-Seite beschreibt eine vorgeschlagene Vorgehensweise und eine Anfrage, keinen bereits freigeschalteten validierten AI-Test. Leadership und Founder Intelligence werden als Anwendungskontexte der vorhandenen Arbeit beschrieben. Die Team-Seite verweist auf das bestehende Team-Scan-Angebot.

### Wissen

`/knowledge` und fünf vertiefende Guides:

- `/knowledge/what-is-ai-readiness`
- `/knowledge/how-to-measure-ai-readiness`
- `/knowledge/why-ai-transformations-fail`
- `/knowledge/ai-adoption-barriers`
- `/knowledge/leadership-and-ai-adoption`

Die zwölf vorgegebenen Nutzerfragen sind auf diese Guides verteilt. Inhaltlich zusammengehörige Fragen werden innerhalb eines Guides beantwortet. Quellen werden unmittelbar mit dem jeweiligen Aussagebereich verbunden.

### Unternehmen und Vertrauen

`/about`, `/founder`, `/methodology`, `/research`, `/contact`, `/legal`, `/privacy`.

Legal und Privacy sind transparente Wegweiser zu den bisher verlinkten Anbieterdokumenten. Sie ersetzen keine rechtlich geprüften Dokumente. Der Founder-Text kennzeichnet die Qualifikationsangaben als vorhandene Angaben des Anbieters; neue Abschlüsse, Awards oder Publikationen wurden nicht ergänzt.

## 4. Schema-Markup

| Typ | Verwendung |
|---|---|
| Organization | Einheitliche Identität `/#organization`, Anbieterreferenz und Name. |
| Person | Eva Kolontai unter `/founder#person`, ohne erfundene Auszeichnungen oder Profile. |
| WebSite | Website und Publisher-Zuordnung. |
| WebPage | Kanonische URL, Titel, Beschreibung, Sprache und Zugehörigkeit. |
| Service | Bestehende Team-/Practitioner-Angebote; keine bereits verfügbare AI-Beratung erfunden. |
| Product | Vorhandener Solo Report. |
| SoftwareApplication | Bestehender browserbasierter AI Companion, kein geplanter Enterprise-Connector. |
| Article | Fünf Knowledge-Guides mit NeuroBusiness als redaktionellem Autor und Aktualisierungsdatum. |
| BreadcrumbList | Hierarchie der Unterseiten. |

FAQPage wurde für diesen Stand bewusst nicht weitergeführt. Sichtbare FAQ-Inhalte bleiben bestehen. Die neuen Artikel sind keine künstlich erzeugten FAQ-Sammlungen; eine FAQ-Rich-Result-Berechtigung wird nicht behauptet.

Geprüft wurden JSON-Parsing, verwendete Typen, wesentliche lokale Pflichtfelder, auflösbare Entity-Referenzen und Breadcrumb-Reihenfolge. Dies ist eine lokale Strukturprüfung. Google Rich Results Test und Schema Markup Validator sollten zusätzlich auf der tatsächlichen Preview/Produktionsauslieferung laufen. Schema.org-konforme Information bedeutet nicht automatisch Rich-Result-Berechtigung; insbesondere werden keine Reviews oder Offers zur Erfüllung von Google-Anforderungen erfunden.

## 5. robots / AI crawler policy

Search und nutzergesteuerte Discovery dürfen öffentliche Inhalte lesen: Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, PerplexityBot/-User und Claude-SearchBot/-User. Die gemeinsamen Regeln schließen private Pfade für alle diese Gruppen aus.

GPTBot und ClaudeBot sind als Training-Crawler getrennt gesperrt. Das ist eine bewusst konservative Trainingspolicy und kann unabhängig von Search/Discovery geändert werden. Weitere Crawler fallen unter die allgemeine Gruppe.

Quiz, Diagnostik, Login, Account, Reports, Dashboard, Admin, API und interne Dateien sind nicht für Discovery vorgesehen. robots.txt schützt keine Daten und garantiert keine Entfernung bereits bekannter URLs. Authentifizierung, Tokenprüfung und Datenbankberechtigungen müssen weiterhin greifen. Bereits indexierte private URLs müssen gegebenenfalls über Search Console/Bing entfernt werden; ein Crawl-Verbot allein genügt nicht.

Referenzen: [Google zu robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro), [OpenAI-Crawler](https://developers.openai.com/api/docs/bots), [Anthropic-Crawler](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler).

## 6. Sitemap

Die generierte XML-Sitemap enthält 25 eindeutige öffentliche Canonicals: vier bestehende Hauptseiten und 21 neue Seiten. Keine Accounts, Diagnostik- oder Ergebnisrouten, APIs oder internen Dateien. Keine geratenen lastmod-Werte. Der Generator hält Sitemap und Seitenmanifest synchron.

## 7. llms.txt

Die neue Datei fasst Organisation, Founder, Angebote, Methodik, AI Readiness, Adoption, Team-/Leadership-/Founder-Kontexte, Enterprise-Status und Knowledge-URLs zusammen. Sie unterscheidet Pilotmodell, bestehende Produkte und vorgeschlagene Methoden.

Auf llms-full.txt wird verzichtet: Die Seiten sind bereits vollständig als HTML lesbar. llms.txt ist eine zusätzliche Orientierungshilfe, keine verbindliche Integrationsschnittstelle und keine Garantie, dass ein AI-System Inhalte liest oder zitiert.

## 8. Verbleibende Cloudflare-Probleme

Live-HTTP-Prüfung am 12.10.2026:

- Startseite, robots, sitemap und llms waren erreichbar.
- Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, GPTBot und PerplexityBot erhielten in Kennungs-Probes HTTP 200.
- ClaudeBot erhielt HTTP 403. Ohne Cloudflare-Logs lässt sich die genaue Ursache nicht zuordnen. Die geplante Training-Sperre ist davon unabhängig; Claude-SearchBot und Claude-User sollten separat aus echten Bot-Netzen geprüft werden.
- Unbekannte URL sowie die noch nicht vorhandene AI-Readiness-URL lieferten die Startseite mit HTTP 200.
- www und non-www blieben beide erreichbar; die drei Angebotsrouten leiteten auf Dateinamenvarianten weiter.
- Live-Build und Repository waren nicht synchron, einschließlich einer zusätzlichen Practitioner-Apply-Route.

Die lokalen Korrekturen müssen in einer echten Pages-Preview bestätigt werden. WAF, AI Crawl Control, Bot Fight Mode, Managed Challenges, Rate Limits, Cache und DNS können nicht aus diesem Repository vollständig geprüft oder geändert werden. Keine globalen Sicherheitsregeln nur anhand eines leicht fälschbaren User-Agent-Headers deaktivieren. Cloudflare-Ereignisse und verifizierte Bot-Identitäten heranziehen.

[Cloudflare Advanced Mode](https://developers.cloudflare.com/pages/functions/advanced-mode/) und [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/) beschreiben die Worker-/Asset-Zuständigkeit und das Hosting-Verhalten. Der lokale Testserver bildet die Plattform nur näherungsweise ab.

## 9. Google Search Console: nächste Schritte

1. Domain-Property und tatsächliche Produktionsdomain verifizieren.
2. Erst nach korrekter Veröffentlichung die Sitemap erneut einreichen.
3. Startseite, AI Readiness, Assessment, Methodology und je einen Artikel per URL-Prüfung testen; gerendertes HTML und ausgewählte Canonical prüfen.
4. Soft-404s, Weiterleitungen, doppelte Seiten, robots-Sperren und versehentlich indexierte private URLs prüfen.
5. Änderungen gezielt zur Indexierung anmelden; keine Massenanmeldung irrelevanter URLs.
6. Core Web Vitals und mobile Nutzbarkeit anhand verfügbarer Felddaten beobachten.
7. Query-/Landingpage-Berichte mit qualifizierten Anfragen und Pilotgesprächen verbinden. Bestehendes Consent-/Tracking-Konzept beibehalten.

## 10. Bing Webmaster Tools: nächste Schritte

Domain verifizieren, Sitemap einreichen, URL Inspection und Site Scan ausführen, Canonicals und Crawling-Fehler prüfen. Bei dauerhaftem Veröffentlichungsprozess IndexNow prüfen und nur echte Änderungen melden. Keine automatische IndexNow-Integration oder Kontoverknüpfung wurde ohne vorhandene Konfiguration erfunden.

## 11. Die 20 wichtigsten Zielqueries

| Query | Primäres Ziel / Status |
|---|---|
| AI readiness assessment | `/ai-readiness-assessment` – Anfrage und Methode |
| AI readiness assessment for companies | `/ai-readiness-assessment` |
| AI readiness consulting | `/ai-readiness-assessment` – Scope klären |
| AI adoption consulting | `/ai-adoption` |
| AI adoption strategy | `/ai-adoption` |
| AI transformation consulting | `/human-ai-transformation` |
| human-centered AI adoption | `/ai-adoption` und Barriers-Guide |
| AI readiness test | `/ai-readiness-assessment` – Unterschied zum bestehenden Quick-Scan |
| AI readiness assessment Germany | `/ai-readiness-assessment` – Lieferung klären, keine erfundene Adresse |
| AI adoption Germany | `/ai-adoption` – deutsche Vertiefung als Content Gap |
| employee AI readiness | Measurement- und Barriers-Guide |
| leadership AI readiness | Leadership-Guide |
| organizational AI readiness | Measurement-Guide |
| AI workforce readiness | `/ai-readiness` |
| AI implementation consulting | `/ai-adoption` – keine technische Integrationsleistung behauptet |
| AI transformation human factors | Failure-Guide und Human AI Transformation |
| AI team assessment | `/team-intelligence` – Kompetenzgrenzen sichtbar |
| team intelligence | `/team-intelligence`, bestehendes Angebot `/teams` |
| leadership assessment | `/leadership-intelligence` – Anfrage |
| AI readiness framework | `/methodology#ai-readiness` |

„AI readiness Berlin“ sollte erst stärker lokal positioniert werden, wenn tatsächliche Standort-/Leistungsinformationen bestätigt sind. Eine Stadtnennung auf der bestehenden Website wurde nicht in eine neue Büroanschrift oder LocalBusiness-Behauptung umgewandelt.

## 12. Content Gaps

- Eindeutig freigegebener AI-spezifischer Leistungsumfang, Ablauf, Verantwortliche und tatsächliche Lieferfähigkeit.
- Veröffentlichte NBIF-Validierung mit Stichprobe, Instrumentversion, Methodik, Ergebnissen und Grenzen.
- Freigegebene Beispielartefakte für Team Map, Leadership Guide, Delegation Matrix und Conflict Snapshot. Die letzten Namen sind derzeit keine nachgewiesenen eigenständigen Releases.
- Echte Fallstudien mit Zustimmung, nachvollziehbarem Ausgangswert und Ergebnis, ohne erfundene Effektzahlen.
- Vollständige deutsche Knowledge-Fassungen und adressierbare englische Marketingversionen.
- Verifizierbare Founder-Biografie, belastbare Primärnachweise und gegebenenfalls veröffentlichte Autorentexte mit persönlicher Freigabe.
- Produktspezifisch geprüfte rechtliche und Datenschutzinformationen für neue Unternehmensangebote.
- Nachweise zu Enterprise-Integrationen, Zugriffsmodell und konkreten Releases, bevor technische Verfügbarkeit behauptet wird.

## 13. Weitere GEO/AEO-Maßnahmen

Eine echte Forschungs-/Methodenpublikation mit stabiler URL, Versionshistorie und korrigierbaren Aussagen ist wertvoller als zusätzliche nahezu identische Suchseiten. Für Originaldaten vorab Fragestellung, Verfahren, Stichprobe und Veröffentlichung klären; Datenschutz und Einwilligungen respektieren.

Bestehende Frameworks als klar abgegrenzte Arbeitsmethoden veröffentlichen, sobald die fachlichen Definitionen freigegeben sind. Praktische Beispielartefakte und nachvollziehbare Fallstudien ergänzen. Externe Erwähnungen durch relevante Facharbeit, Partnerschaften und reale Anwendungen aufbauen. Keine gekauften Scheinzitate oder künstlichen Reviews.

Messung: qualifizierte Anfragen, vereinbarte Piloten, unterstützende Landingpages, Crawl-Erreichbarkeit und beobachtete Quellenverweise. Eine steigende Zahl von Bot-Anfragen ist für sich kein Geschäftserfolg. AI-Antworten können variieren; keine garantierte Aufnahme oder Nennung versprechen.

## 14. Was Code nicht automatisch lösen kann

- Produktionsquelle und Cloudflare-Buildkonfiguration abgleichen.
- WAF-/Crawler-Ereignisse, echte Bot-IP-Zugriffe und Crawl-Logs prüfen.
- Anbieter-, Founder- und Leistungsangaben fachlich bestätigen.
- Psychometrische Validierung durchführen oder Forschungsergebnisse erzeugen.
- Rechtliche Prüfung und ein geeignetes Datenschutz-/Berechtigungsmodell ersetzen.
- Search-Console-/Bing-Eigentum verifizieren, externe Reputation schaffen oder Indexierung/Zitate garantieren.
- Authentifizierte End-to-End-Tests mit Testkonten und Zahlungs-Sandbox durchführen, wenn solche Zugänge nicht vorhanden sind.

## Validierung und Grenzen

- 25 öffentliche Kernseiten mit und ohne JavaScript bei 390 px Mobilbreite: 50 Browser-Prüfungen.
- Je Seite: Status 200, eindeutige Canonical, Titel/Beschreibung, sichtbare H1, lesbarer Hauptinhalt, keine Vorlagen-Platzhalter, kein versehentliches noindex und kein horizontaler Überlauf.
- Interne Pfade, JSON-LD-Struktur, Sitemap-Abgleich, eindeutige IDs, Sprungmarken und Crawler-Regeln geprüft.
- Worker-Tests für interne Dateisperren, private Header, Query-Erhaltung, Alias-Routing, API-POST-Weitergabe und Quiz-Proxy.
- DE/EN-Wechsel auf der Startseite und Team-Kontaktlink im Browser geprüft.
- Skripte in 15 bestehenden Funnel-/Accountseiten sowie API-Worker, Runtime, Trackingdatei und bisherige Redirectdatei mit dem Ausgangsstand verglichen: unverändert.
- Responsive Vorschauen für AI Readiness und Startseite erstellt; neue AI-Readiness-Mobilansicht visuell geprüft.
- Externe HTTP-Prüfung der bestehenden Live-Website durchgeführt, einschließlich Discovery-Dateien und Anbieter-Impressum/Datenschutz.

Nicht durchgeführt: reale Käufe, Kundendatenabruf, neue Einwilligungen, produktive Formulareinsendungen, vollständige authentifizierte Funnel-Durchläufe, unabhängige Accessibility-Zertifizierung, Rich-Results-Freigabe oder nachgelagerter Produktionstest der noch nicht veröffentlichten Änderungen.

Technische Wartung und ausführbare Tests: `_docs/SEARCH_AI_DISCOVERY_MAINTENANCE.md` und `scripts/`. Auditdetails: `_site-source/baseline-audit.json`, `live-audit.json`, `validation-results.json`.
