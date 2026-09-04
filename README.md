# oda-jagdbezirke

Die App **Jagdbezirke** zeigt die Jagdrevier-Grenzen einer kommunalen Quelle auf einer interaktiven Karte, findet die Forstämter in der Nähe und erklärt Schonzeiten sowie richtiges Verhalten im Jagdgebiet.

Die App ist für die Verwendung im [Open Data App Store](https://open-data-app-store.de/) gemacht
und entspricht der [Open Data App](https://open-data-apps.github.io/open-data-app-docs/open-data-app-spezifikation/).

Mehr zu Open Data Apps unter https://github.com/open-data-apps

---

## Funktionen
Die App ist eine Single Page Application (Webapp) mit:

- Logo-Anzeige
- Menü
- Seiten für Impressum, Datenschutz, Beschreibung, Kontakt, Hauptinhalt
- Inhaltsbereich
- Fußzeile

Die Konfiguration wird vom ODAS geladen. Die App zeigt folgende Inhalte:

- **Kennzahlen**: Forstämter im Umkreis, nächstes Amt mit Entfernung, Anzahl Reviere, Wildarten mit Schonzeit in diesem Monat
- **Karte**: Interaktive Leaflet-Karte mit Forstamt-Markern und Revier-Polygonen (OpenStreetMap-Kacheln)
- **Forstamt-Tabelle**: Name, Ort, Entfernung, Telefon mit Detailansicht (Adresse, Kontakt, Zuständigkeits-Disclaimer)
- **Revier-Details**: Klick auf ein Polygon zeigt Bezirksname, Nummer, Fläche und Kontakt-Link (je nach Quelle)
- **Ratgeber**: Verhalten im Jagdgebiet und Schonzeiten-Tabelle (Bundesrahmen mit Landesrecht-Disclaimer)
- **Kommunaler Jagdhinweis**: freier Hinweistext der Kommune (z. B. Drückjagd-Termine), nur wenn konfiguriert

---

## Für wen ist diese App?
Diese App richtet sich an Spaziergängerinnen und Spaziergänger, Hundehalter, Reiterinnen und Reiter sowie Kommunen und Tourismusstellen, die wissen möchten, wo Jagdgebiete liegen und an wen man sich wenden kann. Voraussetzung ist kein spezielles Datenwissen.

---

## Datenformat
Die App nutzt zwei Quellen:

- **DZT Knowledge Graph (SPARQL/JSON)**: Forstamt-POIs mit Name, Adresse, Geo-Koordinate und Kontakt. Abruf in ODAS live über den Store-Relay `/dzt` (der API-Key bleibt serverseitig im Store).
- **Revier-GeoJSON**: FeatureCollection mit Polygonen (Standard: Wetteraukreis via OGC API Features, 236 Reviere mit `JB_NAME`, `JB_NUMMER`, `FLAECHE`, `KONTAKTE`). Direktabruf im Browser (CORS-offen) oder über den ODAS-Proxy, je nach `proxyAktiv`.
- **JagdzeitV 1977 (Bundesgit-Markdown)**: Verordnungstext als Markdown über `raw.githubusercontent.com` (CORS-offen, Gesetze gemeinfrei). Die App parst die §-1-Liste live zu Wildart → Jagdzeit-Intervallen und leitet daraus den aktuellen Schonzeit-Status ab — kein statischer Tabelleninhalt in der App.

Die Revier-Quelle ist optional: Ist keine URL verknüpft, arbeitet die App im DZT-pur-Modus weiter.

---

## Kompatible Datensätze
Die App ist kompatibel mit kommunalen Jagdbezirks-Datensätzen als GeoJSON (WGS84), z. B.:

| Quelle | Format | Zugang |
| ------ | ------ | ------ |
| Jagdbezirke Wetteraukreis (Standard) | GeoJSON via OGC API Features | `.../collections/ft1:Jagdbezirke/items?f=json` |
| Jagdbezirkskarte Essen | statische GeoJSON-Datei (WGS84) | Direktdownload via opendata.essen.de |

Die Feldnamen der Revier-Properties werden generisch dargestellt (keine Feldannahmen); URL-Werte werden als Links gerendert. Lizenzen sind je Quelle zu prüfen (Wetteraukreis/Essen: dl-de/by-2-0 mit Namensnennung).

---

### Systemvoraussetzungen
- Docker / Docker Compose
- Make

### Starten
```bash
make build up
```

Weil die App mit localhost gestartet wird, wird die Konfiguration lokal geladen.

### Lokale Entwicklung mit VS Code Live Server

Alternativ kann die App mit VS Code Live Server aus der Projektwurzel gestartet werden. Öffne dann `http://127.0.0.1:<live-server-port>/app/`; Live Server nutzt standardmäßig Port `5500`.

Empfohlene ODAS-Einstellungen:

```json
{
  "liveServer.settings.host": "127.0.0.1",
  "liveServer.settings.root": "/",
  "liveServer.settings.file": "app/index.html"
}
```

`liveServer.settings.file` ist optional. `liveServer.settings.root` sollte fuer ODAS-Apps normalerweise `/` bleiben, damit `app/` und `odas-config/` gleichzeitig erreichbar sind. `app/app-base.js` wird für lokale Tests **nicht** bearbeitet: `getConfigUrl()` erkennt `127.0.0.1`/`localhost` selbst und lädt dann `../odas-config/config.json`. Dieselbe Datei geht unverändert in die ZIP-Auslieferung. Hinweis: Der DZT-Relay `/dzt` existiert nur in ODAS live — lokal zeigt der DZT-Teil die Relay-Fehlermeldung (erwartet, kein Defekt); der Revier-Abruf läuft lokal im Direktmodus.

### Aufbau der App
Der Inhaltsbereich wird in `app.js` erstellt. Dort ist die gesamte Visualisierungslogik implementiert.

### Wichtige Dateien
| Datei                      | Beschreibung                                                            |
| -------------------------- | ----------------------------------------------------------------------- |
| `app.js`                   | Hauptlogik: DZT-Abruf, Revier-Layer, Leaflet-Karte, Ratgeber            |
| `app-package.json`         | App-Metadaten und Instanz-Konfigurationsfelder für den ODAS             |
| `schema.json`              | Frictionless Data Schema – Forstamt-Tabelle                             |
| `assets/odas-app-icon.svg` | App-Icon                                                                |
| `config.json`              | Lokale Konfiguration für die Entwicklung                                |

---

## Kartenfunktion
Die App verwendet [Leaflet.js](https://leafletjs.com/) (lokal aus `app/vendor/`) für die interaktive Karte mit Forstamt-Markern und Revier-Polygonen. Die Karte nutzt OpenStreetMap-Kacheln und benötigt keinen API-Key. Ein Klick auf ein Revier-Polygon öffnet die Detailansicht mit Bezirksname, Nummer, Fläche und Kontakt-Link (je nach Quelle).

## Konfiguration (Instanz)
Folgende Parameter werden bei der App-Instanzierung im ODAS konfiguriert:

| Parameter          | Beschreibung                                      | Pflicht |
| ------------------ | ------------------------------------------------- | ------- |
| `apiurls`          | URLs zu Datenressourcen (Array, `name`/`label`/`url` je Eintrag: `dztsparql`, `jagdbezirke`) | ja (`dztsparql`), nein (`jagdbezirke`) |
| `urlDaten`         | URL zur Katalog-Seite des Revier-Datensatzes im ODP | nein   |
| `ort`              | Ortsname für die Forstamt-Umkreissuche            | ja      |
| `radiusKm`         | Suchradius in km                                  | ja      |
| `jagdHinweis`      | Kommunaler Jagdhinweis (Markdown, leer = ausgeblendet) | nein |
| `proxyAktiv`       | ODAS-Proxy für den Revier-Abruf (`nein`/`ja`)     | ja      |
| `titel`            | Anzeigetitel der App                              | ja      |
| `seitentitel`      | Browser-Tab-Titel                                 | ja      |

Was bei der App-Entwicklung beachtet werden sollte, steht in der ODA-Spezifikation.

---

## Beim Aufruf kontaktierte Drittanbieter

Beim Aufruf dieser App werden keine externen Server für Programmbibliotheken
kontaktiert; alle Bibliotheken werden lokal aus `app/vendor/` ausgeliefert.

Der DZT-Abruf läuft in ODAS live über den Store-Relay `/dzt` (der API-Key bleibt
serverseitig im Store); lokal existiert dieser Relay nicht. Die Revier-Quelle wird
direkt bzw. über den ODAS-Proxy abgerufen, je nach `proxyAktiv`.

Zusätzlich kontaktiert werden:

- `nominatim.openstreetmap.org` — Ortssuche (Geokodierung)
- `tile.openstreetmap.org` — Kartenkacheln (OpenStreetMap)
- `www.geoportal.hessen.de` — Reviergrenzen (Standard-Quelle; bei anderer Revier-Quelle deren Host)

Die DZT-Schnittstelle `proxy.opendatagermany.io` wird nicht vom Browser, sondern
serverseitig vom Open Data App Store kontaktiert.

Bei externen Links (z. B. KONTAKTE-PDFs der Reviere) gilt: Der Kontakt entsteht erst beim Klick,
nicht beim Aufruf — das ist bei den jeweiligen Einträgen zu vermerken.

---

## Autor
© 2026, Ondics GmbH
