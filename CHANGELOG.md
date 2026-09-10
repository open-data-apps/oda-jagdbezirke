# Changelog

## 1.0.9 - 2026-09-10
- **FIX:** Revier-Hinweis nennt den Datensatz nicht mehr hartkodiert „Wetteraukreis“, sondern neutral „konfigurierter Revier-Datensatz“ (H-1, Kosmetik bei Custom-Quellen).

## 1.0.8 - 2026-09-10
- **FIX:** Verwaistes `app/vendor/chartjs/` (F-108, Template-Rest ohne Referenz, 204 K) entfernt — kleineres Liefer-ZIP.
- **FIX:** Karten-Viewport gehört jetzt dem Suchraum (Ort + Radius), nicht mehr den Revier-Daten: `renderReviere` hat den `setView(Ort)`-Viewport per bedingungslosem `fitBounds(Revier-Bounds)` mit dem ortsfesten Wetteraukreis-Ausschnitt überschrieben — die Karte zeigte dadurch immer das Gleiche, egal welcher Ort eingestellt war. Neu: `jbSuchraumBounds` + `zentriereKarteAufSuchraum` (Wanderwege-Muster), Karten- und Revier-Hinweis nennen Ort, Radius und Abstand zum Datensatz (Überlappungs-/Außerhalb-Satz). Verifiziert im Dev-Store mit Friedberg (Hessen) und München.

## 1.0.7 - 2026-09-08
- **FIX:** Geocoding-Fehler (F-107, Live-Fund): Nominatim antwortet unter Last mit HTTP 429; die CORS-lose HTML-Fehlerseite wird vom Browser als `Failed to fetch` gemeldet und löste den irreführenden CORS/Proxy-Hinweis aus. `jbGeocode` fängt den Netzwerkfehler jetzt und meldet die tatsächliche Ursache (1.0.6 -> 1.0.7).

## 1.0.6 - 2026-09-08
- **FIX:** Typ-Erwartung „Statische Datei“ akzeptiert jetzt auch `.md`-Quellen (F-97): die gültige JagdzeitV-Markdown-URL wurde bei Ladefehlern fälschlich als Typ-Mismatch gemeldet.

## 1.0.5 - 2026-09-08
- **FIX:** `safeHttpUrl` für DZT-`schema:url`-Links (F-90): `javascript:`/`data:`-Ziele werden nicht mehr als `href` gerendert, sondern als Text.
- **FIX:** `jbInstances` wird bei `onPageLeave` geleert (F-91) — Registry hielt bislang detached DOM und Datenarrays über Seitenwechsel hinweg.

## 1.0.4 - 2026-09-08
- **FIX:** Datenschutz-Dreiklang angeglichen: einheitliche Aufzählungszeichen, `raw.githubusercontent.com` auch im README, B3-Satz („direkt aus der konfigurierten Datenquelle“) in Paket und lokaler Config; App im Vendor-Host-Manifest registriert (Doku-/Host-Check grün).

## 1.0.3 - 2026-09-07
- **FIX:** Frictionless-Härtung: alle 3 Slots mit Code-Beleg dokumentiert (SPARQL-Basis per wanderwege-Präzedenz, OGC-`f=json` vom Validator nicht erkannt, Markdown wird live geparst — je dokumentierte Ausnahme, Rot-Beleg im REPORT); `f=json`-Lücke als Store-Hinweis aufgenommen.

## 1.0.2 - 2026-09-07
- FIX: Lint-Gate grün (`jagdHinweis`-Kategorie registriert, `apiurls`-Hilfe im Satzbau „Diese App benötigt …")

## 1.0.1 - 2026-09-04
- ENH: Schonzeiten als Monats-Selektor (Heute + 12 Monate) mit Schonzeit/Jagdzeit-Toggle; Forstamt-Details als kompakte Leaflet-Popups; KPI mit Live-Datum; echte Screenshots + README-Sektion
- FIX: GeoJSON-URL-Typcheck (.geojson, OGC-API f=json//items; Datensatzseiten weiter abgewiesen); proxyAktiv-Hilfe mit CORS-Hinweis (Essen braucht ja)

## 1.0.0 - 2026-09-03
- ENH: App-Gerüst aus oda-generic mit Metadaten, Icon, Schema und Beschreibung
