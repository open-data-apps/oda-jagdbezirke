# Changelog

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
