/*
 * oda-jagdbezirke – Jagdrevier-Grenzen, Forstämter und Verhaltensratgeber.
 *
 * Datenquellen:
 *  - DZT Knowledge Graph (SPARQL): Forstamt-POIs im Umkreis des konfigurierten
 *    Orts. Abruf in ODAS live über den Store-Relay (GET <appPath>/dzt?path=<pfad>);
 *    der Relay ergänzt Host, "/api/"-Präfix und den serverseitigen API-Key.
 *    Außerhalb einer ODAS-Instanz (Live Server, Standalone) gibt es diesen Relay
 *    nicht — die App zeigt dann einen Hinweis statt DZT-Daten.
 *  - Revier-GeoJSON (Task 4): optionale kommunale Quelle (Standard Wetteraukreis).
 *
 * @param {Object} configdata - Alle Konfigurationsdaten der App
 * @param {Object} enclosingHtmlDivElement - HTML Knoten des umschließenden Tags
 */
async function app(configdata = {}, enclosingHtmlDivElement) {
  if (!enclosingHtmlDivElement) {
    throw new Error("Der Inhaltsbereich der App wurde nicht gefunden.");
  }
  const uid = "i" + ++jbInstanzZaehler;
  const state = {
    uid,
    container: enclosingHtmlDivElement,
    config: configdata,
    center: null,
    centerLabel: "",
    forstaemter: [],
    loaded: false,
    detailIndex: -1,
    forstMarker: [],
    revierLayerRefs: [],
    reviere: [],
    revierLayer: null,
    jagdzeilen: [],
    jagdGanzjahr: "",
    refModus: "heute",
    refTag: 0,
    refMonat: 0,
    ansicht: "schon",
    monatSelectInit: false,
    map: null,
    markerLayer: null,
    abort: null,
    disposed: false,
  };
  jbInstances.set(uid, state);
  const jetzt = new Date();
  state.refTag = jetzt.getDate();
  state.refMonat = jetzt.getMonth() + 1;
  state.refModus = "heute";

  state.container.innerHTML = renderJbShell(state);
  renderJbHinweis(state);
  renderJbMethodik(state);
  renderJbInfos(state);

  const sparqlUrl = getOdasApiUrl(configdata, "dztsparql");
  const ort = String(configdata.ort || "").trim();
  if (isKeineDatenquelleKonfiguriert(sparqlUrl)) {
    setJbStatus(state, "Es ist keine DZT-Datenquelle konfiguriert.", "info");
  } else if (!ort) {
    setJbStatus(state, "Es ist kein Ort konfiguriert. Bitte in der Instanzkonfiguration einen Ort eintragen.", "info");
  } else {
    await ladeForstaemter(state, sparqlUrl, ort);
  }
  await ladeReviere(state);
  await ladeJagdzeiten(state);
  aktualisiereKpis(state);
  return null;
}

function onPageLeave(page) {
  jbInstances.forEach((state) => {
    state.disposed = true;
    if (state.abort) {
      try { state.abort.abort(); } catch (_e) {}
      state.abort = null;
    }
    if (state.map) {
      try { state.map.remove(); } catch (_e) {}
      state.map = null;
    }
    state.markerLayer = null;
  });
}

// ---------------------------------------------------------------------------
// Instanzzustand (F-42-Muster: Zähler + Map, kein Datensatz auf Modulebene)
// ---------------------------------------------------------------------------

let jbInstanzZaehler = 0;
const jbInstances = new Map();
var jbLeafletPromise = null;

const JB_DEFAULT_RADIUS_KM = 25;
const JB_FORST_RE = /forst|revier|förster/i;
// Ausschlüsse gegen POI-Namensrauschen: Orte, die nur wegen eines
// Wald-/Straßen-Namens matchen (Klinik, Friedhof, Museum …), sowie andere
// Revier-Begriffe (Polizei). Greift nur auf schema:name, nie auf Adressen.
const JB_FORST_AUSSCHLUSS_RE = /polizei|bücherei|bibliothek|museum|archiv|schule|kindergarten|kita|rathaus|krankenhaus|klinik|friedhof|allee|straße|gmbh/i;

// ---------------------------------------------------------------------------
// Shell / Status
// ---------------------------------------------------------------------------

function renderJbShell(state) {
  const uid = state.uid;
  return (
    '<div class="jb-app" data-jb-uid="' + escapeHtml(uid) + '">' +
    '<div class="row g-3 mb-3">' +
    kpiCard(uid, "jb-kpi-forst", "Forstämter im Umkreis", "DZT Knowledge Graph") +
    kpiCard(uid, "jb-kpi-revier", "Reviere", "kommunale Quelle") +
    kpiCard(uid, "jb-kpi-schon", "Tierarten in Schonzeit", "JagdzeitV 1977", "jb-kpi-schon-sub") +
    "</div>" +
    '<div id="jb-hinweis-' + uid + '"></div>' +
    '<div id="jb-status-' + uid + '" class="jb-status text-muted small mb-3">Forstämter werden gesucht …</div>' +
    '<div class="visually-hidden" role="status" id="jb-live-' + uid + '"></div>' +
    '<div class="row g-3 mb-2">' +
    '<div class="col-12 col-lg-8">' +
    '<div id="jb-karte-' + uid + '" class="jb-karte" style="height:380px; border-radius:8px; background:var(--bs-secondary-bg);"></div>' +
    '<p id="jb-kartenhinweis-' + uid + '" class="text-muted small mb-1 mt-1">Karte wird vorbereitet …</p>' +
    '<p id="jb-revierhinweis-' + uid + '" class="text-muted small mb-2 mt-0"></p>' +
    "</div>" +
    '<div class="col-12 col-lg-4">' +
    '<div class="card h-100 shadow-sm"><div class="card-body p-2 d-flex flex-column">' +
    '<h3 class="h6 mb-2">Forstämter in der Nähe</h3>' +
    '<div id="jb-liste-' + uid + '" class="list-group list-group-flush overflow-auto" style="max-height:380px;">' +
    '<div class="text-center p-3 text-muted small"><span class="spinner-border spinner-border-sm me-2" role="status"><span class="visually-hidden">Laden</span></span>Suche läuft …</div>' +
    "</div>" +
    "</div></div>" +
    "</div>" +
    "</div>" +
    '<section class="mt-4" id="jb-schon-' + uid + '">' +
    '<h2 class="h5 mb-1">Schonzeiten (Bundesrahmen)</h2>' +
    '<p class="small text-muted">Live aus der JagdzeitV 1977 geparst (Bundesgit). Je Bundesland gelten abweichende Zeiten (Landesrecht) — verbindlich Auskunft geben Forstamt und untere Jagdbehörde. Keine Rechtsberatung.</p>' +
    '<div class="row g-2 mb-3"><div class="col-12 col-sm-6 col-md-4">' +
    '<label class="form-label small mb-1" for="jb-monat-' + uid + '">Stand</label>' +
    '<select class="form-select form-select-sm" id="jb-monat-' + uid + '"></select>' +
    "</div></div>" +
    '<div id="jb-ganzjahr-' + uid + '"></div>' +
    '<div id="jb-schonfehler-' + uid + '"></div>' +
    '<div class="btn-group btn-group-sm mt-1 mb-2" role="group" aria-label="Schonzeit oder Jagdzeit anzeigen">' +
    '<button type="button" class="btn btn-outline-primary" id="jb-toggle-schon-' + uid + '"></button>' +
    '<button type="button" class="btn btn-outline-primary" id="jb-toggle-jagd-' + uid + '"></button>' +
    '</div>' +
    '<div class="list-group list-group-flush" id="jb-jagdliste-' + uid + '"></div>' +
    "</section>" +
    '<section class="mt-4">' +
    '<h2 class="h5 mb-1">Wie verhalte ich mich im Jagdgebiet?</h2>' +
    '<p class="small text-muted">Redaktioneller Ratgeber der App (kein Datensatz, keine Rechtsberatung).</p>' +
    '<ul class="small mb-0">' +
    "<li>Auf den Wegen bleiben; Absperrungen und Schilder — zum Beispiel bei Drückjagden — beachten.</li>" +
    "<li>Hunde anleinen und Wild nicht beunruhigen.</li>" +
    "<li>Dämmerung meiden: Hauptaktivitätszeit von Wild und Jagd.</li>" +
    "<li>Wild weder anfassen noch füttern; Fallwild liegen lassen und dem Forstamt melden.</li>" +
    "<li>Bei Unsicherheit: Forstamt oder untere Jagdbehörde fragen (Kontakte siehe oben).</li>" +
    "</ul>" +
    "</section>" +
    '<div id="jb-methodik-' + uid + '"></div>' +
    '<div id="jb-infos-' + uid + '"></div>' +
    "</div>"
  );
}

function kpiCard(uid, id, label, kontext, subId) {
  return (
    '<div class="col-12 col-sm-6 col-lg-4">' +
    '<div class="card h-100 shadow-sm border-0"><div class="card-body">' +
    '<div class="text-muted small mb-1">' + escapeHtml(label) + "</div>" +
    '<div class="h3 mb-1" id="' + id + "-" + uid + '">—</div>' +
    '<div class="small text-muted"' + (subId ? ' id="' + subId + "-" + uid + '"' : "") + '>' + escapeHtml(kontext) + "</div>" +
    "</div></div></div>"
  );
}

function jbStandDatum(datum) {
  return "Stand: " + datum.getDate() + ". " + jbMonatsname(datum.getMonth() + 1) + " " + datum.getFullYear() + " · JagdzeitV 1977";
}

function jbEl(state, name) {
  return state.container.querySelector("#jb-" + name + "-" + state.uid);
}

function setJbStatus(state, text, kind) {
  const el = jbEl(state, "status");
  if (!el) return;
  // Hinweiszeile statt Alert-Box (KPI darüber zeigt die Zahl bereits).
  // Echte Fehler kommen über renderOdasFehler() als eigene Alert-Box.
  el.className = "jb-status text-muted small mb-3";
  el.textContent = text;
}

// ---------------------------------------------------------------------------
// Laden: Geocoding -> SPARQL (DZT-Relay) -> Rendern
// ---------------------------------------------------------------------------

async function ladeForstaemter(state, sparqlUrl, ort) {
  state.abort = new AbortController();
  const signal = state.abort.signal;
  try {
    const center = await jbGeocode(ort, signal);
    if (!center) {
      setJbStatus(state, "Der Ort „" + ort + "“ wurde nicht gefunden. Bitte die Schreibweise in der Instanzkonfiguration prüfen.", "info");
      return;
    }
    state.center = center;
    state.centerLabel = center.label;
    const radiusKm = Math.max(1, Math.round(Number(state.config.radiusKm) || JB_DEFAULT_RADIUS_KM));
    const rows = await jbFetchSparql(buildForstSparql(center.lat, center.lon, radiusKm), state.config, sparqlUrl, signal);
    state.forstaemter = parseForstRows(rows, center, radiusKm);
    state.loaded = true;
    if (state.forstaemter.length === 0) {
      setJbStatus(state, "Keine Forstämter um " + center.label + " gefunden (Radius " + radiusKm + " km).", "info");
      const liste = jbEl(state, "liste");
      if (liste) liste.innerHTML = '<div class="p-3 text-muted small">Keine Daten gefunden.</div>';
      return;
    }
    setJbStatus(state, state.forstaemter.length === 1
      ? "1 Forstamt · " + radiusKm + " km um " + center.label + "."
      : state.forstaemter.length + " Forstämter · " + radiusKm + " km um " + center.label + ".", "info");
    renderJbListe(state);
    await initJbKarte(state);
    aktualisiereKpis(state);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    jbFehlerAnzeigen(state, error, sparqlUrl);
  }
}

function jbFehlerAnzeigen(state, error, sparqlUrl) {
  const lokal = /localhost|127\.0\.0\.1/.test(String(window.location.hostname || ""));
  if (lokal && /Failed to fetch|HTTP 404|404/.test(String((error && error.message) || error))) {
    setJbStatus(state, "Der DZT-Abruf läuft nur in ODAS live (Store-Relay /dzt). Lokal wird die Forstamt-Suche nicht geladen – das ist kein Defekt.", "info");
    const liste = jbEl(state, "liste");
    if (liste) liste.innerHTML = '<div class="p-3 text-muted small">Lokal keine DZT-Daten (Relay nur in ODAS live).</div>';
    return;
  }
  const box = jbEl(state, "status");
  renderOdasFehler(box, error, { url: sparqlUrl, label: "SPARQL-Endpunkt (DZT)", erwarteterTyp: "sparql" });
}

async function jbGeocode(ort, signal) {
  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ format: "jsonv2", limit: "1", q: ort }).toString();
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error("Die Ortssuche antwortet mit HTTP " + response.status + ".");
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const treffer = data[0];
  return { lat: Number(treffer.lat), lon: Number(treffer.lon), label: String(treffer.display_name || ort).split(",")[0] };
}

// Der Relay hängt an https://proxy.opendatagermany.io/api/ an — der konfigurierte
// SPARQL-Endpunkt (…/api/ts/v1/kg/sparql) verliert dafür sein "/api/"-Präfix.
function dztApiPath(apiurl) {
  try {
    return new URL(String(apiurl || "")).pathname.replace(/^\/+api\/?/, "");
  } catch (_error) {
    return "";
  }
}

async function jbFetchSparql(query, configdata, sparqlUrl, signal) {
  const base = dztApiPath(sparqlUrl);
  if (!base) throw new Error("Der SPARQL-Endpunkt konnte nicht aus der Instanzkonfiguration abgeleitet werden.");
  const path = base + "?" + new URLSearchParams({ query }).toString();
  const url = getOdasAppBasePath() + "/dzt?path=" + encodeURIComponent(path);
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/sparql-results+json" }, signal });
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    throw new Error("Datenabruf fehlgeschlagen: " + error.message);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Der Zugang zur DZT-Schnittstelle wurde abgelehnt. Bitte den Betreiber des Open Data App Store informieren.");
  }
  if (response.status === 429) {
    throw new Error("Das Tageslimit der DZT-Schnittstelle ist erreicht. Bitte später erneut versuchen.");
  }
  if (!response.ok) {
    throw new Error("Die DZT-Schnittstelle antwortet mit HTTP " + response.status + ".");
  }
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return (json && json.results && json.results.bindings) || [];
  } catch (_error) {
    throw new Error("Die DZT-Schnittstelle liefert kein JSON. Bitte später erneut versuchen.");
  }
}

// HINWEIS: Die beiden REGEX-Listen müssen mit JB_FORST_RE / JB_FORST_AUSSCHLUSS_RE
// unten synchron bleiben (serverseitige Vorfilterung, clientseitige Nachfilterung).
function buildForstSparql(lat, lon, radiusKm) {
  const geoShapeJson = JSON.stringify({
    query: {
      geo_shape: {
        geometry: {
          shape: { type: "circle", radius: Math.max(1, Math.round(Number(radiusKm) || JB_DEFAULT_RADIUS_KM)) + "km", coordinates: [Number(lon), Number(lat)] },
          relation: "intersects",
        },
      },
    },
  });
  return `PREFIX inst: <http://www.ontotext.com/connectors/elasticsearch/instance#>
PREFIX con: <http://www.ontotext.com/connectors/elasticsearch#>
PREFIX schema: <https://schema.org/>

SELECT ?id ?name ?strasse ?plz ?ort ?lat ?lon ?tel ?web ?descr ?apn ?apv WHERE {
  ?search a inst:dzt-geo-shapes ;
    con:query ${JSON.stringify(geoShapeJson)} ;
    con:entities ?geoent .
  ?geoent schema:name ?name .
  FILTER(REGEX(?name, 'forst|revier|förster', 'i'))
  FILTER(!REGEX(?name, 'polizei|bücherei|bibliothek|museum|archiv|schule|kindergarten|kita|rathaus|krankenhaus|klinik|friedhof|allee|straße|gmbh', 'i'))
  BIND(?geoent AS ?id)
  OPTIONAL {
    ?geoent schema:address ?addr .
    OPTIONAL { ?addr schema:streetAddress ?strasse }
    OPTIONAL { ?addr schema:postalCode ?plz }
    OPTIONAL { ?addr schema:addressLocality ?ort }
  }
  OPTIONAL {
    ?geoent schema:geo ?geo .
    OPTIONAL { ?geo schema:latitude ?lat ; schema:longitude ?lon }
  }
  FILTER(BOUND(?lat))
  OPTIONAL { ?geoent schema:telephone ?tel }
  OPTIONAL { ?geoent schema:url ?web }
  OPTIONAL { ?geoent schema:description ?descr }
  OPTIONAL {
    ?geoent schema:additionalProperty ?ap .
    ?ap schema:name ?apn ; schema:value ?apv .
  }
}
LIMIT 1000`;
}

function sparqlText(binding) {
  if (!binding) return "";
  return String(binding.value == null ? "" : binding.value);
}

function parseForstRows(rows, center, radiusKm) {
  const proId = new Map();
  rows.forEach((row) => {
    const id = sparqlText(row.id);
    if (!id) return;
    if (!proId.has(id)) {
      proId.set(id, { id, namen: [], strasse: "", plz: "", ort: "", lat: NaN, lon: NaN, tel: "", web: "", descr: "", mail: "" });
    }
    const eintrag = proId.get(id);
    const name = sparqlText(row.name);
    if (name) eintrag.namen.push({ text: name, lang: (row.name && row.name["xml:lang"]) || "" });
    if (!eintrag.strasse) eintrag.strasse = sparqlText(row.strasse);
    if (!eintrag.plz) eintrag.plz = sparqlText(row.plz);
    if (!eintrag.ort) eintrag.ort = sparqlText(row.ort);
    if (!Number.isFinite(eintrag.lat)) {
      const lat = Number(sparqlText(row.lat));
      const lon = Number(sparqlText(row.lon));
      if (Number.isFinite(lat) && Number.isFinite(lon)) { eintrag.lat = lat; eintrag.lon = lon; }
    }
    if (!eintrag.tel) eintrag.tel = sparqlText(row.tel);
    if (!eintrag.web) eintrag.web = sparqlText(row.web);
    if (!eintrag.descr) {
      const lang = row.descr && row.descr["xml:lang"];
      if (!lang || lang === "de") eintrag.descr = sparqlText(row.descr);
    }
    if (!eintrag.mail && String(sparqlText(row.apn)).toLowerCase() === "email") {
      eintrag.mail = sparqlText(row.apv);
    }
  });
  const treffer = [];
  proId.forEach((eintrag) => {
    const name = waehleName(eintrag.namen);
    if (!name || !JB_FORST_RE.test(name) || JB_FORST_AUSSCHLUSS_RE.test(name)) return;
    if (!Number.isFinite(eintrag.lat) || !Number.isFinite(eintrag.lon)) return;
    const distanzKm = haversineKm(center.lat, center.lon, eintrag.lat, eintrag.lon);
    if (distanzKm > radiusKm + 0.5) return;
    treffer.push({
      id: eintrag.id,
      name,
      strasse: eintrag.strasse,
      plz: eintrag.plz,
      ort: eintrag.ort,
      tel: eintrag.tel,
      mail: eintrag.mail,
      web: eintrag.web,
      descr: eintrag.descr,
      lat: eintrag.lat,
      lon: eintrag.lon,
      distanzKm,
    });
  });
  treffer.sort((a, b) => a.distanzKm - b.distanzKm);
  return treffer;
}

// Die Trefferreihenfolge je Entität ist nicht deterministisch (de/en-Dubletten).
// Deshalb bevorzugt die Auswahl einen passenden deutschsprachigen Namen — sonst
// hinge das Zählergebnis davon ab, welche Dublette zufällig an erster Stelle steht.
function waehleName(namen) {
  const passend = namen.filter((n) => JB_FORST_RE.test(n.text) && !JB_FORST_AUSSCHLUSS_RE.test(n.text));
  const pool = passend.length ? passend : namen;
  const deutsch = pool.find((n) => n.lang === "de");
  return ((deutsch || pool[0]) || {}).text || "";
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function formatiereKm(km) {
  return Number(km).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " km";
}

// ---------------------------------------------------------------------------
// Rendern: Liste + Popups (eine Übersicht, ein Detail-Ort)
// ---------------------------------------------------------------------------

function jbAnkuendigen(state, text) {
  const live = jbEl(state, "live");
  if (live) live.textContent = text;
}

function renderJbListe(state) {
  const liste = jbEl(state, "liste");
  if (!liste) return;
  liste.innerHTML = state.forstaemter.map((amt, idx) => {
    return (
      '<button type="button" class="list-group-item list-group-item-action" data-jb-idx="' + idx + '">' +
      '<span class="d-block fw-semibold">' + escapeHtml(amt.name) + "</span>" +
      '<span class="d-block small text-muted">' + escapeHtml([amt.plz, amt.ort].filter(Boolean).join(" ")) + " · " + escapeHtml(formatiereKm(amt.distanzKm)) + "</span>" +
      "</button>"
    );
  }).join("");
  liste.querySelectorAll("[data-jb-idx]").forEach((btn) => {
    btn.addEventListener("click", () => auswaehlenForst(state, Number(btn.getAttribute("data-jb-idx"))));
  });
}

function jbForstPopupHtml(amt) {
  const adresse = [amt.strasse, [amt.plz, amt.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const zeilen = [];
  if (adresse) zeilen.push(escapeHtml(adresse));
  if (Number.isFinite(amt.distanzKm)) zeilen.push(escapeHtml(formatiereKm(amt.distanzKm)) + " vom Suchort");
  if (amt.tel) zeilen.push('Telefon: <a href="tel:' + escapeHtml(amt.tel.replace(/[\s/()-]/g, "")) + '">' + escapeHtml(amt.tel) + "</a>");
  if (amt.mail) zeilen.push('E-Mail: <a href="mailto:' + escapeHtml(amt.mail) + '">' + escapeHtml(amt.mail) + "</a>");
  if (amt.web) zeilen.push('Web: <a href="' + escapeHtml(amt.web) + '" target="_blank" rel="noopener">' + escapeHtml(amt.web) + "</a>");
  if (amt.descr) zeilen.push(escapeHtml(amt.descr));
  zeilen.push('<span class="text-muted">Zuständigkeitsgebiet beim Amt erfragen (DZT enthält keine Reviergrenzen).</span>');
  return '<div class="jb-popup"><strong>' + escapeHtml(amt.name) + "</strong><br>" + zeilen.join("<br>") + "</div>";
}

function jbRevierPopupHtml(feature) {
  const daten = revierDetailDaten(feature);
  const teile = ["<strong>" + escapeHtml(daten.titel) + "</strong>"];
  if (daten.adresse) teile.push(escapeHtml(daten.adresse));
  daten.kontakt.forEach((z) => {
    teile.push((z.label ? escapeHtml(z.label) + ": " : "") + (z.href
      ? '<a href="' + escapeHtml(z.text) + '" target="_blank" rel="noopener">' + escapeHtml(z.text) + "</a>"
      : escapeHtml(z.text)));
  });
  if (daten.extras.length) {
    teile.push("<details><summary>Weitere Angaben</summary>" + daten.extras.map((z) => escapeHtml(z.label) + ": " + (z.href
      ? '<a href="' + escapeHtml(z.text) + '" target="_blank" rel="noopener">' + escapeHtml(z.text) + "</a>"
      : escapeHtml(z.text))).join("<br>") + "</details>");
  }
  return '<div class="jb-popup">' + teile.join("<br>") + "</div>";
}

function auswaehlenForst(state, idx) {
  const amt = state.forstaemter[idx];
  if (!amt) return;
  state.detailIndex = idx;
  jbAnkuendigen(state, "Details zu " + amt.name + " geöffnet.");
  const marker = state.forstMarker[idx];
  if (state.map && marker) {
    try {
      state.map.panTo([amt.lat, amt.lon]);
      marker.openPopup();
    } catch (_e) {}
  }
}

// ---------------------------------------------------------------------------
// Revier-Layer (optionale kommunale GeoJSON, OGC API Features mit Pagination)
// ---------------------------------------------------------------------------

async function ladeReviere(state) {
  const url = getOdasApiUrl(state.config, "jagdbezirke");
  const hinweis = jbEl(state, "revierhinweis");
  if (isKeineDatenquelleKonfiguriert(url)) {
    if (hinweis) hinweis.textContent = "Reviergrenzen: keine kommunale Quelle verknüpft (DZT-pur-Modus).";
    aktualisiereKpis(state);
    return;
  }
  try {
    const features = await ladeOgcFeatures(url, state.config, state.abort ? state.abort.signal : undefined);
    state.reviere = features;
    if (!state.map && state.center) await initJbKarte(state);
    renderReviere(state);
    if (hinweis) {
      hinweis.textContent = features.length
        ? "Revier-Polygone: " + features.length + " Bezirke (Klick für Details). Quelle: kommunaler Datensatz, dl-de/by-2-0."
        : "Revier-Quelle erreichbar, aber ohne Bezirke.";
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (hinweis) hinweis.textContent = "";
    const box = jbEl(state, "revierhinweis");
    const err = document.createElement("div");
    if (box && box.parentNode) box.parentNode.insertBefore(err, box.nextSibling);
    renderOdasFehler(err, error, { url, label: "Jagdbezirke (GeoJSON)", erwarteterTyp: "geojson" });
  }
  aktualisiereKpis(state);
}

async function ladeOgcFeatures(basisUrl, configdata, signal) {
  const alle = [];
  const seite = 100;
  let offset = 0;
  for (;;) {
    const trenner = basisUrl.includes("?") ? "&" : "?";
    const seite1 = await fetchOdasJson(basisUrl + trenner + "limit=" + seite + "&offset=" + offset, configdata);
    if (signal && signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
    const features = (seite1 && seite1.features) || [];
    if (!Array.isArray(features) || features.length === 0) break;
    alle.push(...features);
    if (features.length < seite) break;
    offset += seite;
    if (offset > 5000) break;
  }
  return alle;
}

function renderReviere(state) {
  if (!state.map || !window.L) return;
  if (state.revierLayer) {
    try { state.map.removeLayer(state.revierLayer); } catch (_e) {}
    state.revierLayer = null;
  }
  state.revierLayerRefs = [];
  if (!state.reviere.length) return;
  state.revierLayer = window.L.geoJSON({ type: "FeatureCollection", features: state.reviere }, {
    style: { color: "#0d6efd", weight: 1.5, fillOpacity: 0.12 },
    onEachFeature: (feature, layer) => {
      layer.bindPopup(() => jbRevierPopupHtml(feature), { maxWidth: 280 });
      layer.on("popupopen", () => jbAnkuendigen(state, "Details zu " + revierDetailDaten(feature).titel + " geöffnet."));
      state.revierLayerRefs.push(layer);
    },
  }).addTo(state.map);
  try { state.map.fitBounds(state.revierLayer.getBounds(), { padding: [20, 20] }); } catch (_e) {}
}

function revierDetailDaten(feature) {
  const props = (feature && feature.properties) || {};
  const str = (k) => {
    const v = props[k];
    return v === null || v === undefined ? "" : String(v);
  };
  const istUrl = (s) => /^https?:\/\//i.test(s);
  const nummer = str("JB_NUMMER") || str("JB_UJB_ESS") || str("ID") || str("id");
  const titel = str("JB_NAME") || (nummer ? "Revier " + nummer : "Revier");
  const adressTeile = [];
  if (nummer) adressTeile.push("Nr. " + nummer);
  if (str("KOMMUNE")) adressTeile.push(str("KOMMUNE"));
  if (str("FLAECHE")) adressTeile.push("Fläche (Quellwert): " + str("FLAECHE"));
  const kontakt = [];
  if (str("KONTAKTE")) kontakt.push({ label: "Kontakt", text: str("KONTAKTE"), href: istUrl(str("KONTAKTE")) });
  if (str("ABSCHUSSZA")) kontakt.push({ label: "", text: str("ABSCHUSSZA"), href: false });
  // Technische IDs (GML-/Quellsystem-Schlüssel) sind laut Info-Popup-Pattern
  // kein sinnvoller Popup-Inhalt und werden ausgeblendet.
  const benutzt = { JB_NAME: 1, JB_NUMMER: 1, JB_UJB_ESS: 1, ID: 1, id: 1, FLAECHE: 1, KOMMUNE: 1, KONTAKTE: 1, ABSCHUSSZA: 1, gml_id: 1, LOKAL_ID: 1, AGS: 1 };
  const extras = [];
  Object.keys(props).forEach((k) => {
    if (benutzt[k]) return;
    const v = props[k];
    if (v === null || v === undefined || v === "") return;
    if (typeof v === "object") return;
    extras.push({ label: k, text: String(v), href: istUrl(String(v)) });
  });
  return { titel, adresse: adressTeile.join(" · "), kontakt, extras };
}

// ---------------------------------------------------------------------------
// Schonzeiten: JagdzeitV 1977 live parsen (kein statischer Tabelleninhalt)
// ---------------------------------------------------------------------------

const JB_MONATE = {
  // Schlüssel in normalisierter Form (klein, ä->a, nur a-z): "März" wird zu "marz".
  januar: 1, februar: 2, marz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

function jbMonat(name) {
  const norm = String(name || "").toLowerCase().replace(/ä/g, "a").replace(/[^a-z]/g, "");
  return JB_MONATE[norm] || 0;
}

function jbParseDatum(tag, monatName) {
  return { t: Number(tag) || 0, m: jbMonat(monatName) };
}

function jbDatumWert(d) {
  return d.m * 100 + d.t;
}

function jbIntervallDeckt(intervall, tag, monat) {
  const aktuell = monat * 100 + tag;
  const von = jbDatumWert(intervall.von);
  const bis = jbDatumWert(intervall.bis);
  if (!von || !bis) return false;
  if (bis >= von) return aktuell >= von && aktuell <= bis;
  return aktuell >= von || aktuell <= bis;
}

function jbMdInhaltszeilen(text) {
  const zeilen = [];
  String(text || "").split(/\r?\n/).forEach((roh) => {
    let s = roh.replace(/^\s+/, "");
    while (s.startsWith("*")) s = s.slice(1).replace(/^\s+/, "");
    if (s) zeilen.push(s);
  });
  return zeilen;
}

function jbParseIntervalle(zeitText) {
  const intervalle = [];
  const re = /vom\s+(\d{1,2})\.\s*([A-Za-zäöüÄÖÜß]+)\s+bis\s+(\d{1,2})\.\s*([A-Za-zäöüÄÖÜß]+)/g;
  let treffer;
  while ((treffer = re.exec(zeitText)) !== null) {
    const von = jbParseDatum(treffer[1], treffer[2]);
    const bis = jbParseDatum(treffer[3], treffer[4]);
    if (von.m && bis.m) intervalle.push({ von, bis });
  }
  return intervalle;
}

function jbParseJagdzeitV(markdown) {
  const zeilen = jbMdInhaltszeilen(markdown);
  const start = zeilen.findIndex((z) => z === "## § 1");
  if (start < 0) throw new Error("Unerwartetes Format: § 1 nicht gefunden.");
  const gruppen = [];
  let gruppe = null;
  let gruppeNeu = false;
  let unter = null;
  let ganzjahr = "";
  let sammleGanzjahr = false;
  for (let i = start + 1; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (z === "## § 2") break;
    if (/^\d+\.$/.test(z)) {
      gruppe = { name: "", zeilen: [] };
      gruppen.push(gruppe);
      gruppeNeu = true;
      unter = null;
      sammleGanzjahr = false;
      continue;
    }
    if (/^##\s/.test(z) || /^\(3\)/.test(z)) { sammleGanzjahr = false; continue; }
    if (/^\(2\)/.test(z)) { ganzjahr = z; sammleGanzjahr = true; continue; }
    if (/^\(\d\)/.test(z)) { sammleGanzjahr = false; continue; }
    if (sammleGanzjahr) { ganzjahr += " " + z; continue; }
    if (!gruppe) continue;
    if (/^vom\s/i.test(z)) {
      const intervalle = jbParseIntervalle(z);
      if (!intervalle.length) continue;
      if (unter) {
        unter.intervalle.push(...intervalle);
        unter.zeitText += " / " + z;
      } else {
        let direkt = gruppe.zeilen.find((e) => e.unter === "");
        if (!direkt) {
          direkt = { unter: "", zeitText: z, intervalle: [] };
          gruppe.zeilen.push(direkt);
        } else {
          direkt.zeitText += " / " + z;
        }
        direkt.intervalle.push(...intervalle);
      }
      continue;
    }
    if (gruppeNeu) {
      gruppe.name = z;
      gruppeNeu = false;
    } else {
      unter = { unter: z, zeitText: "", intervalle: [] };
      gruppe.zeilen.push(unter);
    }
  }
  const raus = [];
  gruppen.forEach((g) => {
    if (/weggefallen/i.test(g.name)) return;
    g.zeilen.forEach((e) => {
      if (!e.intervalle.length) return;
      raus.push({ gruppe: g.name, unter: e.unter, zeitText: e.zeitText, intervalle: e.intervalle });
    });
  });
  return { zeilen: raus, ganzjahr };
}

async function ladeJagdzeiten(state) {
  const url = getOdasApiUrl(state.config, "jagdzeiten");
  const jagdliste = jbEl(state, "jagdliste");
  const fehlerBox = jbEl(state, "schonfehler");
  if (isKeineDatenquelleKonfiguriert(url)) {
    if (jagdliste) jagdliste.innerHTML = '<div class="list-group-item px-0 small text-muted">Keine Jagdzeiten-Quelle konfiguriert.</div>';
    aktualisiereKpis(state);
    return;
  }
  try {
    const markdown = await fetchOdasResource(url, state.config);
    const parsed = jbParseJagdzeitV(markdown);
    state.jagdzeilen = parsed.zeilen;
    state.jagdGanzjahr = parsed.ganzjahr;
    renderSchonzeiten(state);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    state.jagdzeilen = [];
    if (jagdliste) jagdliste.innerHTML = "";
    renderOdasFehler(fehlerBox, error, { url, label: "Jagdzeiten (JagdzeitV 1977)", erwarteterTyp: "csv-zip" });
  }
  aktualisiereKpis(state);
}

const JB_MONATSNAMEN = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function jbMonatsname(m) {
  return JB_MONATSNAMEN[m - 1] || "";
}

function jbZeilenNachStatus(zeilen, tag, monat) {
  const jagd = [];
  const schon = [];
  zeilen.forEach((zeile) => {
    const inJagdzeit = zeile.intervalle.some((iv) => jbIntervallDeckt(iv, tag, monat));
    (inJagdzeit ? jagd : schon).push(zeile);
  });
  return { jagd, schon };
}

function renderMonatsSelect(state) {
  const select = jbEl(state, "monat");
  // Einmal aufbauen: Bei jedem Neuaufbau würde die Auswahl auf "Heute"
  // zurückspringen und sich Change-Listener stapeln (Bug 2026-09-03).
  if (!select || state.monatSelectInit) return;
  state.monatSelectInit = true;
  const heute = new Date();
  select.innerHTML = '<option value="heute">Heute (' + heute.getDate() + ". " + jbMonatsname(heute.getMonth() + 1) + ")</option>" +
    JB_MONATSNAMEN.map((name, i) => '<option value="' + (i + 1) + '">' + escapeHtml(name) + "</option>").join("");
  select.value = "heute";
  select.addEventListener("change", () => {
    if (select.value === "heute") {
      const neu = new Date();
      state.refModus = "heute";
      state.refTag = neu.getDate();
      state.refMonat = neu.getMonth() + 1;
    } else {
      state.refModus = "mitte";
      state.refTag = 15;
      state.refMonat = Number(select.value);
    }
    renderSchonzeiten(state);
  });
}

function jbGruppiereZeilen(zeilen) {
  const gruppen = [];
  zeilen.forEach((zeile) => {
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && letzte.gruppe === zeile.gruppe) letzte.eintraege.push(zeile);
    else gruppen.push({ gruppe: zeile.gruppe, eintraege: [zeile] });
  });
  return gruppen;
}

function renderSchonzeiten(state) {
  const liste = jbEl(state, "jagdliste");
  const ganzjahrBox = jbEl(state, "ganzjahr");
  if (!liste) return;
  renderMonatsSelect(state);
  const aufgeteilt = jbZeilenNachStatus(state.jagdzeilen, state.refTag, state.refMonat);
  const aktiv = state.ansicht === "jagd" ? aufgeteilt.jagd : aufgeteilt.schon;
  const btnSchon = jbEl(state, "toggle-schon");
  const btnJagd = jbEl(state, "toggle-jagd");
  if (btnSchon && btnJagd) {
    btnSchon.textContent = "Schonzeit (" + aufgeteilt.schon.length + ")";
    btnJagd.textContent = "Jagdzeit (" + aufgeteilt.jagd.length + ")";
    btnSchon.classList.toggle("active", state.ansicht !== "jagd");
    btnJagd.classList.toggle("active", state.ansicht === "jagd");
    btnSchon.onclick = () => { state.ansicht = "schon"; renderSchonzeiten(state); };
    btnJagd.onclick = () => { state.ansicht = "jagd"; renderSchonzeiten(state); };
  }
  let html = "";
  jbGruppiereZeilen(aktiv).forEach((gruppe) => {
    html += '<div class="mt-2 mb-1 small fw-bold text-muted">' + escapeHtml(gruppe.gruppe) + "</div>";
    gruppe.eintraege.forEach((zeile) => {
      html += '<div class="list-group-item px-0 py-1">' +
        (zeile.unter ? '<div class="fw-semibold small">' + escapeHtml(zeile.unter) + "</div>" : "") +
        '<div class="small text-muted">' + escapeHtml(zeile.zeitText) + "</div></div>";
    });
  });
  liste.innerHTML = html || '<div class="list-group-item px-0 small text-muted">Keine.</div>';
  if (ganzjahrBox) {
    ganzjahrBox.innerHTML = state.jagdGanzjahr
      ? '<div class="alert alert-info small" role="alert">' + escapeHtml(state.jagdGanzjahr) + "</div>"
      : "";
  }
}

// ---------------------------------------------------------------------------
// KPIs, Hinweis, Methodik, Links (Schale 4)
// ---------------------------------------------------------------------------

function aktualisiereKpis(state) {
  const forst = jbEl(state, "kpi-forst");
  const revier = jbEl(state, "kpi-revier");
  const schon = jbEl(state, "kpi-schon");
  if (forst && state.loaded) forst.textContent = Number(state.forstaemter.length).toLocaleString("de-DE");
  if (revier) {
    const url = getOdasApiUrl(state.config, "jagdbezirke");
    revier.textContent = isKeineDatenquelleKonfiguriert(url)
      ? "–"
      : Number(state.reviere.length).toLocaleString("de-DE");
  }
  if (schon && state.jagdzeilen.length) {
    const heute = new Date();
    const tag = heute.getDate();
    const monat = heute.getMonth() + 1;
    const inSchonzeit = state.jagdzeilen.filter((z) => !z.intervalle.some((iv) => jbIntervallDeckt(iv, tag, monat))).length;
    schon.textContent = inSchonzeit + " von " + state.jagdzeilen.length;
    const sub = jbEl(state, "kpi-schon-sub");
    if (sub) sub.textContent = jbStandDatum(heute);
  }
}

function renderJbHinweis(state) {
  const box = jbEl(state, "hinweis");
  if (!box) return;
  const text = String(state.config.jagdHinweis || "").trim();
  box.innerHTML = text
    ? '<div class="alert alert-warning" role="alert"><strong>Jagdhinweis:</strong> ' + text + "</div>"
    : "";
}

function renderJbMethodik(state) {
  const box = jbEl(state, "methodik");
  if (!box) return;
  const hinweis = String(state.config.datenquelleHinweis || "").trim();
  const stand = String(state.config.datenStand || "").trim();
  if (!hinweis && !stand) { box.innerHTML = ""; return; }
  const uid = state.uid;
  box.innerHTML =
    '<section class="jb-methodik mt-4">' +
    '<button class="jb-methodik-toggle collapsed" type="button" ' +
    'data-bs-toggle="collapse" data-bs-target="#jb-methodik-body-' + uid + '" ' +
    'aria-expanded="false" aria-controls="jb-methodik-body-' + uid + '">' +
    '<span class="h5 mb-0">Methodik &amp; Datenquelle</span>' +
    '<span class="jb-methodik-chevron" aria-hidden="true">&#9662;</span>' +
    "</button>" +
    '<div id="jb-methodik-body-' + uid + '" class="collapse">' +
    '<div class="jb-methodik-content">' +
    (stand ? '<p class="text-muted small mb-2">' + escapeHtml(stand) + "</p>" : "") +
    hinweis +
    "</div></div></section>";
}

function renderJbInfos(state) {
  const box = jbEl(state, "infos");
  if (!box) return;
  const uid = state.uid;
  const links = String(state.config.weiterfuehrendeLinks || "").trim();
  if (!links) { box.innerHTML = ""; return; }
  box.innerHTML =
    '<section class="jb-weitere-infos mt-4">' +
    '<button class="jb-methodik-toggle collapsed" type="button" ' +
    'data-bs-toggle="collapse" data-bs-target="#jb-infos-body-' + uid + '" ' +
    'aria-expanded="false" aria-controls="jb-infos-body-' + uid + '">' +
    '<span class="h5 mb-0">Weitere Informationen</span>' +
    '<span class="jb-methodik-chevron" aria-hidden="true">&#9662;</span>' +
    "</button>" +
    '<div id="jb-infos-body-' + uid + '" class="collapse">' +
    '<div class="jb-methodik-content jb-weitere-infos-content">' + links + "</div></div></section>";
}

// ---------------------------------------------------------------------------
// Karte (Leaflet, dynamisch aus app/vendor/)
// ---------------------------------------------------------------------------

function ladeLeaflet() {
  if (jbLeafletPromise) return jbLeafletPromise;
  jbLeafletPromise = new Promise((resolve, reject) => {
    if (window.L && window.L.map) { resolve(window.L); return; }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/leaflet/leaflet.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "vendor/leaflet/leaflet.js";
    script.onload = () => (window.L && window.L.map ? resolve(window.L) : reject(new Error("Leaflet konnte nicht initialisiert werden.")));
    script.onerror = () => reject(new Error("Leaflet konnte nicht geladen werden."));
    document.head.appendChild(script);
  });
  return jbLeafletPromise;
}

async function initJbKarte(state) {
  const el = jbEl(state, "karte");
  const hinweis = jbEl(state, "kartenhinweis");
  if (!el || !state.center) return;
  let leaflet;
  try {
    leaflet = await ladeLeaflet();
  } catch (error) {
    if (hinweis) hinweis.textContent = "Karte nicht verfügbar: " + error.message;
    return;
  }
  if (state.disposed || !document.contains(el)) return;
  try {
    const karte = leaflet.map(el).setView([state.center.lat, state.center.lon], 11);
    state.map = karte;
    leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(karte);
    state.markerLayer = leaflet.layerGroup().addTo(karte);
    state.forstMarker = [];
    state.forstaemter.forEach((amt, idx) => {
      const marker = leaflet.marker([amt.lat, amt.lon], { title: amt.name });
      marker.bindPopup(() => jbForstPopupHtml(amt), { maxWidth: 280 });
      marker.on("popupopen", () => jbAnkuendigen(state, "Details zu " + amt.name + " geöffnet."));
      marker.bindTooltip(amt.name);
      state.markerLayer.addLayer(marker);
      state.forstMarker[idx] = marker;
    });
    if (hinweis) hinweis.textContent = "Marker: Forstämter. Quelle Kartenkacheln: OpenStreetMap.";
  } catch (error) {
    if (hinweis) hinweis.textContent = "Karte konnte nicht initialisiert werden.";
  }
}

// ---------------------------------------------------------------------------
// Template-Helfer (aus oda-generic, unverändert übernommen)
// ---------------------------------------------------------------------------

function isOdasProxyEnabled(configdata = {}) {
  return String(configdata.proxyAktiv || "").trim().toLowerCase() === "ja";
}

function extractPathFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname + parsedUrl.search;
  } catch (_error) {
    return String(url || "");
  }
}

function getOdasAppBasePath(pathname) {
  let appPath =
    pathname === undefined
      ? typeof window !== "undefined"
        ? window.location.pathname
        : "/"
      : String(pathname || "/");

  if (!appPath.endsWith("/")) {
    const lastSlashIndex = appPath.lastIndexOf("/");
    const lastSegment = appPath.substring(lastSlashIndex + 1);
    if (lastSegment.includes(".")) {
      appPath = appPath.substring(0, lastSlashIndex + 1);
    }
  }

  return appPath.replace(/\/+$/, "");
}

function getOdasProxyEndpoint(targetUrl, pathname) {
  const appPath = getOdasAppBasePath(pathname);
  return `${appPath}/odp-data?path=${encodeURIComponent(targetUrl)}`;
}

function isKeineDatenquelleKonfiguriert(targetUrl) {
  const quelle = String(targetUrl || "").trim();
  return !quelle || /^\{\{.*\}\}$/.test(quelle) || /^<.*>$/.test(quelle);
}

async function fetchViaOdasProxy(targetUrl) {
  if (isKeineDatenquelleKonfiguriert(targetUrl)) {
    throw new Error("Keine Datenquelle konfiguriert.");
  }

  const response = await fetch(getOdasProxyEndpoint(targetUrl), {
    method: "POST",
  });

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch (_e) {}
    const originHint = /origin not allowed/i.test(body) ? " – URL origin not allowed" : "";
    throw new Error(`ODAS-Proxy-Fehler: HTTP ${response.status}${originHint}`);
  }

  const proxyData = await response.json();
  if (!proxyData || typeof proxyData.content !== "string") {
    throw new Error("ODAS-Proxy-Antwort enthält keinen content-String.");
  }

  return proxyData.content;
}

async function fetchOdasResource(targetUrl, configdata = {}) {
  if (isKeineDatenquelleKonfiguriert(targetUrl)) {
    throw new Error("Keine Datenquelle konfiguriert.");
  }

  if (isOdasProxyEnabled(configdata)) {
    return fetchViaOdasProxy(targetUrl);
  }

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    throw new Error(
      `Direkter Datenabruf fehlgeschlagen (${error.message}). Bitte prüfen Sie die Daten-URL und die CORS-Freigabe der Datenquelle.`,
    );
  }
}

function getOdasApiUrl(configdata, name) {
  const liste = Array.isArray(configdata && configdata.apiurls)
    ? configdata.apiurls
    : [];
  const treffer = liste.find((eintrag) => eintrag && eintrag.name === name);
  return String((treffer && treffer.url) || "").trim();
}

async function fetchOdasJson(targetUrl, configdata = {}) {
  const rawContent = await fetchOdasResource(targetUrl, configdata);
  try {
    return JSON.parse(rawContent);
  } catch (_error) {
    throw new Error(
      `Die konfigurierte Daten-URL liefert kein JSON, sondern ${describeNonJsonPayload(rawContent)}. ` +
        "Bitte in der Instanzkonfiguration den API-Endpunkt der Datenquelle eintragen, " +
        "nicht den Datensatz- oder Download-Link.",
    );
  }
}

function describeNonJsonPayload(rawContent) {
  const text = String(rawContent == null ? "" : rawContent).trim();
  if (!text) return "eine leere Antwort";
  if (text.startsWith("<")) return "eine HTML-Seite";
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (/[,;]/.test(firstLine)) return "eine CSV- oder Textdatei";
  return "unlesbaren Inhalt";
}

const TYP_BEZEICHNUNG = {
  "ckan-dkan-ds": "Tabellen-API mit Daten-ID",
  "ckan-ps": "Datensatz-API",
  "ckan-dl": "Datei-Download",
  "ods21": "Open-Data-Suche (API v2.1)",
  "wfs": "Kartendienst (WFS)",
  "geojson": "GeoJSON-Abruf (Datei oder OGC API)",
  "sparql": "Wissensdatenbank (SPARQL)",
  "csv-zip": "Statische Datei"
};

function validateUrlTypErwartung(url, erwarteterTyp) {
  const u = String(url || "");
  if (!erwarteterTyp || isKeineDatenquelleKonfiguriert(u)) return null;
  const checks = {
    "ckan-dkan-ds": /\/api\/3\/action\/datastore_search\?resource_id=/i,
    "ckan-ps": /\/api\/3\/action\/package_show\?id=/i,
    "ckan-dl": /\/dataset\/.*\/resource\/.*\/download\//i,
    "ods21": /\/api\/explore\/v2\.1\//i,
    "wfs": /service=WFS/i,
    "geojson": /\.geojson(\?|$)|[?&]f=json\b|\/items(\?|$)/i,
    "sparql": /\/api\/ts\/v1\/kg\/sparql/i,
    "csv-zip": /\.(csv|json|zip)(\?|$)/i
  };
  const re = checks[erwarteterTyp];
  if (!re) return null;
  if (!re.test(u)) {
    const soll = TYP_BEZEICHNUNG[erwarteterTyp] || erwarteterTyp;
    return `Typ passt nicht: erwartet „${soll}", erhalten „${u.slice(0, 60)}…". Prüfen Sie den Hilfe-Tooltip bei „URLs zu Datenressourcen".`;
  }
  return null;
}

function classifyOdasFehler(error, kontext = {}) {
  const msg = String((error && error.message) || error || "");
  const url = String(kontext.url || "");
  const label = String(kontext.label || "Datenressource");
  const typLabel = String(kontext.typLabel || TYP_BEZEICHNUNG[kontext.erwarteterTyp] || "Datenquelle");
  if (/Keine Datenquelle konfiguriert/i.test(msg) || isKeineDatenquelleKonfiguriert(url)) {
    return {
      kind: "KEINE_QUELLE",
      titel: "Es ist keine Datenquelle konfiguriert.",
      hinweis: `Prüfen Sie unter „URLs zu Datenressourcen → ${label}" ob eine gültige ${typLabel}-URL eingetragen ist (Hilfe-Tooltip beachten).`,
      detail: msg,
      alertClass: "alert-info"
    };
  }
  if (/Typ passt nicht: erwartet/i.test(msg)) {
    return {
      kind: "TYP_MISMATCH",
      titel: msg,
      hinweis: `Diese App erwartet ${typLabel}. Korrigieren Sie die URL gemäß Hilfe-Tooltip (Beispiel dort).`,
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/URL origin not allowed/i.test(msg)) {
    return {
      kind: "PROXY_ORIGIN",
      titel: "ODAS-Proxy blockiert: Ziel-Origin nicht freigegeben.",
      hinweis: "Tragen Sie die Ziel-Origin als eigenen Eintrag unter „URLs zu Datenressourcen“ ein oder prüfen Sie proxyAktiv.",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/ODAS-Proxy-Fehler/i.test(msg) || /kein content-String/i.test(msg)) {
    return {
      kind: "PROXY_HTTP",
      titel: msg,
      hinweis: "Prüfen Sie proxyAktiv und Erreichbarkeit im ODAS-Live-System (lokal 404 ist normal).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/Direkter Datenabruf fehlgeschlagen/i.test(msg) || /Failed to fetch/i.test(msg)) {
    const corsHint = /Failed to fetch/i.test(msg) ? " – vermutlich CORS blockiert → im ODAS-Live proxyAktiv=ja." : "";
    return {
      kind: "DIREKT_CORS_HTTP",
      titel: msg,
      hinweis: `Prüfen Sie URL und CORS der Quelle${corsHint}`,
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/liefert kein JSON/i.test(msg) || /HTML-Seite|CSV-|leere Antwort|unlesbaren/i.test(msg)) {
    return {
      kind: "PAYLOAD_TYP",
      titel: msg,
      hinweis: "Tragen Sie den passenden Endpunkt ein – nicht die Datensatzseite (/dataset/…) – Hilfe-Tooltip beachten.",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/CKAN.*Fehler|success:false/i.test(msg)) {
    return {
      kind: "CKAN_API",
      titel: msg,
      hinweis: "Prüfen Sie Daten-ID / Datensatz-ID (existiert die Tabelle/Datei noch auf dem Portal?).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/404|Nicht gefunden/i.test(msg)) {
    return {
      kind: "HTTP_404",
      titel: msg,
      hinweis: "Ressource/Datensatz auf dem Portal nicht gefunden (404).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  return {
    kind: "UNBEKANNT",
    titel: msg || "Unbekannter Fehler beim Laden.",
    hinweis: "Prüfen Sie Konfiguration und Erreichbarkeit der Quelle.",
    detail: msg,
    alertClass: "alert-danger"
  };
}

function renderOdasFehler(container, error, kontext = {}) {
  if (!container) return;
  const typWarn = validateUrlTypErwartung(kontext.url, kontext.erwarteterTyp);
  if (typWarn && !/Typ passt nicht/i.test(String(error && error.message))) {
    error = new Error(typWarn);
  }
  const info = classifyOdasFehler(error, kontext);
  const url = String(kontext.url || "");
  const urlZeile = url ? `<p class="mb-1 small text-muted">Konfigurierte URL: <code>${escapeHtml(url.length > 80 ? url.slice(0, 80) + "…" : url)}</code></p>` : "";
  const titel = kontext.leer ? "Keine Datensätze gefunden." : info.titel;
  const alertClass = kontext.leer ? "alert-info" : info.alertClass;
  container.innerHTML = `<div class="alert ${alertClass}" role="alert"><strong>${escapeHtml(titel)}</strong><p class="mb-1">${escapeHtml(info.hinweis)}</p>${urlZeile}<details class="small"><summary>Details</summary><code>${escapeHtml(info.detail || String(error))}</code></details></div>`;
}

function isLeerErgebnis(json) {
  if (!json) return true;
  if (Array.isArray(json) && json.length === 0) return true;
  if (Array.isArray(json.records) && json.records.length === 0) return true;
  if (Array.isArray(json.results) && json.results.length === 0) return true;
  if (json.result && Array.isArray(json.result.records) && json.result.records.length === 0) return true;
  return false;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/*
 * Diese Funktion kann Bibliotheken und benötigte Skripte laden.
 */
function addToHead() {}
