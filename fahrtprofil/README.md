# Fahrtprofil – GPS & Verbrauch

Offline nutzbare Web-App (PWA) zur Aufzeichnung von Fahrten per GPS, Anzeige der
Strecke auf einer mitgelieferten Karte und farblicher Darstellung des
Verbrauchs. Deutsche Oberfläche, kein externer Tile-Server, keine CDN-Abhängigkeit.

## Schnellstart

```powershell
cd fahrtprofil
python -m http.server 5173 --bind 127.0.0.1
```

Danach <http://127.0.0.1:5173/> öffnen. Die App startet mit einer simulierten
Fahrt München – Starnberg – Herrsching, damit Karte, Kurve und Auswahl sofort
sichtbar sind.

## Was die App kann

- **Offline-Karte**: gebündelte OSM-Vektordaten (`data/basemap.js`, ~1,9 MB) werden
  von einem eigenen Leaflet-`GridLayer` in Canvas gezeichnet. Straßen, Wasser,
  Grünflächen, Bahnstrecken und Ortslabels sind enthalten; es gibt keine
  Netzwerkanfragen an Karten-Server.
- **Route nach Verbrauch eingefärbt**: Farbskala 0–16 L/100 km
  (grün → gelb → rot), Segmente oberhalb von 16 bleiben rot.
- **Verbrauchskurve**: Canvas-Chart mit Phasenbändern (Stadt / Landstraße /
  Autobahn), Hover-Tooltip und Klick-Auswahl.
- **Synchronisierte Werte**: Klick oder Hover auf Karte bzw. Kurve zeigt
  Kilometerstand, Verbrauch, Tempo, Höhe und Phase; ein Marker läuft mit.
- **Wiedergabe**: Play/Pause, Scrubber und „Folgen“-Schalter für die Fahrt.
- **GPS-Aufzeichnung**: Start über den Button „GPS“, Live-Anzeige von Strecke,
  Tempo, Genauigkeit und Punktzahl, Stopp wertet die Fahrt aus.
- **Kennzahlen-Leiste**: rechts neben Karte und Kurve stehen Strecke,
  Ø-Verbrauch, Fahrzeit, Ø-Tempo und Spitze der aktuellen Fahrt in großen
  Kacheln; darunter Archivsumme und der Einstieg „Fahrten“. Auf schmalen
  Displays wird daraus eine horizontal scrollbare Leiste unter der Kopfzeile.
- **Fahrtenarchiv**: GPS-Aufzeichnungen und Importe werden automatisch lokal
  gespeichert. Die Dashboard-Seite „Fahrten“ zeigt Anzahl, Gesamtstrecke,
  Ø-Verbrauch, Gesamtverbrauch, Fahrzeit und Ø-Tempo in großer Schrift; jede
  Fahrt lässt sich öffnen oder löschen.
- **Import**: GPX, CSV und JSON über „Daten laden“.
- **Export**: aktuelle Fahrt als JSON.
- **PWA**: Manifest, Icons und Service Worker für Installation und Offline-Betrieb.

## GPS auf dem Android-Gerät

Die Aufzeichnung nutzt die Browser-Geolocation-API. Wichtig:

- Geolocation und Service Worker funktionieren **nur in einem sicheren Kontext**,
  also über `https://` oder `localhost`.
- Ein Aufruf über die LAN-IP (`http://192.168.x.x:5173`) wird vom Browser
  blockiert. Für Feldtests die App über HTTPS bereitstellen, z. B. mit einem
  Reverse-Proxy oder einem temporären Zertifikat.
- Beim ersten Start fragt der Browser nach der Standortfreigabe. Ohne Freigabe
  bricht die Aufzeichnung mit einem Hinweis ab.
- Schlechte Genauigkeit (> 100 m) wird verworfen, Sprünge unter 1,5 m in kurzer
  Zeit werden gefiltert.

Für dauerhaftes Hintergrund-Tracking gibt es die **Android-App** (siehe unten):
Sie bettet diese Web-App ein und nutzt einen GPS-Vordergrunddienst.

## Android-App

Im Repo-Ordner darüber (`app/`) steckt eine Android-Hülle (Kotlin, WebView). Der
Ordner `fahrtprofil/` ist die einzige Quelle der Oberfläche: Beim Build wird er als
Asset `www` in die APK kopiert (ohne `tools/` und README).

- **Start**: lokale Auslieferung über `https://appassets.androidplatform.net/`
  (sicherer Kontext, kein Server nötig, alles offline).
- **GPS**: `js/native-bridge.js` ersetzt `navigator.geolocation`. Ein
  Vordergrunddienst sammelt Punkte jede Sekunde, auch bei ausgeschaltetem
  Bildschirm. Die Web-App holt sie ab und wertet sie wie normale Positionen aus.
- **Export**: „Als JSON exportieren“ öffnet das Teilen-Menü.
- **Import**: „Daten laden“ öffnet den Android-Dateiauswähler.
- **Updates**: Die App fragt beim Start die GitHub-Release `latest` ab und zeigt nur
  bei einer neueren Version ein Banner mit „Herunterladen und installieren“.
- **Service Worker**: in der App deaktiviert (alles liegt ohnehin lokal).
- **Paket-ID**: bleibt `de.blumenthalmedia.balltest`, damit die App die frühere
  Ball-Test-App ersetzt.
- Jeder Push auf `main` baut per GitHub Actions eine neue APK.

Grenzen: Wird die App aus der Übersicht weggewischt, endet auch die Aufzeichnung.
Punkte liegen nur im Arbeitsspeicher, bis die Fahrt beendet und gespeichert wird.

## Gespeicherte Fahrten

Jede beendete GPS-Aufzeichnung und jeder Import landet automatisch im
Fahrtenarchiv. Der Button „Fahrten“ in der Kennzahlen-Leiste (auf schmalen
Displays in der Kopfzeile) zeigt die Anzahl und öffnet die Dashboard-Seite.

- **Speicherort**: IndexedDB-Datenbank `fahrtprofil` mit den Stores `trips`
  (vollständige Punkte) und `summaries` (Kennzahlen). Alles bleibt lokal im
  Browserprofil des Geräts – kein Server, keine Cloud.
- **Fallback**: Steht IndexedDB nicht zur Verfügung, wird `localStorage` genutzt
  (deutlich kleineres Kontingent).
- **Dashboard**: sechs Kacheln mit großer Schrift für Gesamtstrecke,
  Ø-Verbrauch (gewichtet, farbig nach Verbrauchsskala), Gesamtverbrauch,
  Anzahl der Fahrten, Gesamtfahrzeit und Ø-Tempo.
- **Lesbarkeit im Auto**: vollflächige Seite statt schmalem Drawer, Werte
  24–38 px, Fahrtnamen 16–19 px (max. zwei Zeilen), Zeilen 78–84 px hoch,
  Löschknopf 46–52 px. Der Ausgang ist als „Zur Karte“ beschriftet.
- **Öffnen**: Klick auf eine Zeile lädt die Fahrt mit Karte, Kurve und
  Wiedergabe. Die zuletzt geöffnete Fahrt ist in der Liste markiert.
- **Löschen**: Papierkorb-Symbol mit Rückfrage; die Aufzeichnung wird dauerhaft
  aus dem Gerät entfernt.
- **Sicherung**: Einzelne Fahrten über „Export“ als JSON sichern; die Datei
  lässt sich später wieder importieren.
- **Achtung**: Beim Löschen der Website-Daten im Browser verschwindet auch das
  Archiv. Wichtige Fahrten vorher exportieren.

## Verbrauch: geschätzt vs. gemessen

Bei GPS-Aufnahmen und GPX-Importen liegen keine Momentanverbräuche vor. Der
Verbrauch wird dann aus Tempo, Steigung und Fahrmodus geschätzt und in der
Oberfläche klar als **„Verbrauch geschätzt“** gekennzeichnet. Der Ø-Verbrauch
wird als `getankte Liter / gefahrene km * 100` berechnet, nicht als Mittel der
Punktwerte.

Echte Werte lassen sich über CSV/JSON mitliefern; dann entfällt die Schätzung
für die betroffenen Punkte.

## Datenformate

### JSON

```json
{
  "name": "Fahrt zur Arbeit",
  "date": "2026-10-29T07:12:00Z",
  "points": [
    { "lat": 48.1374, "lng": 11.5755, "ele": 519, "speed": 32, "cons": 6.4, "time": 1761721920 }
  ]
}
```

`points` ist Pflicht. `cons` (L/100 km) ist optional, ebenso `speed` (km/h),
`ele` (m), `time` (Unix-Sekunden oder ISO-String) und `dist` (m).

### CSV

Trennzeichen `;` oder `,` wird automatisch erkannt, Dezimalkomma ist erlaubt.
Spaltennamen sind tolerant (Groß-/Kleinschreibung, Umlaute):

```csv
lat;lng;ele;speed;cons;time
48.1374;11.5755;519;32;6.4;2026-10-29T07:12:00Z
```

Erkannte Aliase sind u. a. `lat|latitude|breite`, `lng|lon|longitude|laenge`,
`ele|hoehe|altitude`, `speed|tempo|kmh`, `cons|verbrauch|l100km|fuel`,
`time|zeit|timestamp`, `dist|strecke|distanz`.

### GPX

Standard-GPX mit `trkpt`, optional `ele` und `time`. Der Verbrauch wird
geschätzt.

## OBD-II-Ausblick

Für echte Momentanverbräuche bietet sich ein OBD-II-Adapter (ELM327, Bluetooth
oder WLAN) an. Relevante PID: `0x5E` (Kraftstoffverbrauch), `0x04` (Motorlast),
`0x0D` (Tempo), `0x10` (MAF). Sinnvoller Weg:

1. Export als CSV mit Zeitstempel je Sekunde.
2. GPS-Punkte und OBD-Zeitreihe über den Zeitstempel zusammenführen.
3. Ergebnis als JSON mit `cons` je Punkt importieren.

Damit bleibt die App reine Anzeige- und Auswertungsschicht, die Anbindung kann
später nativ oder über einen Logger erfolgen.

## Projektstruktur

```
fahrtprofil/
  index.html              Layout, Buttons, Recorder, Chart
  styles.css              komplettes Styling
  js/app.js               Karte, Chart, Auswahl, GPS, PWA, Export
  js/simulate.js          Simulation + TripSim.finalize() für Importe
  js/data.js              Importadapter für JSON, CSV, GPX
  js/store.js             Fahrtenarchiv (IndexedDB, Fallback localStorage)
  js/basemap.js           Offline-Vektorlayer und Ortslabels
  data/basemap.js         gebündelte OSM-Geometrie (ODbL)
  vendor/                 lokales Leaflet 1.9.4
  sw.js                   Offline-Cache
  manifest.webmanifest    PWA-Manifest
  icons/                  PWA-Icons
  tools/build_basemap.py  erzeugt data/basemap.js aus Overpass-Daten
  tools/make_icons.py     erzeugt die PWA-Icons
```

## Karte neu bauen

`tools/build_basemap.py` lädt die OSM-Daten für den Korridor München–Ammersee
per Overpass, vereinfacht die Geometrien und schreibt `data/basemap.js`.
Nebenstraßen (`residential`, `unclassified`, `living_street`) werden mitgeladen
und ab Zoomstufe 12,5 gezeichnet.

```powershell
python tools\build_basemap.py
```

Der Rohdownload wird unter `tools/cache/osm_raw.json` zwischengespeichert.
Überlastete Overpass-Server antworten gelegentlich mit HTTP 502 – dann später
erneut versuchen.

## Service Worker / Updates

`sw.js` cached die App-Shell mit Cache-Namen `fahrtprofil-v25`. Navigationen
werden **network-first** geladen (offline aus dem Cache), statische Assets aus
dem Cache mit Hintergrund-Aktualisierung. Der Precache nutzt `cache: 'reload'`
und umgeht damit den HTTP-Cache, der sonst eine alte `index.html` liefern
könnte. Nach Änderungen an HTML, CSS, JS oder Kartendaten **beides gemeinsam**
erhöhen:

- `CACHE` in `sw.js` (z. B. `fahrtprofil-v26`)
- `?v=` an Stylesheet und Skripten in `index.html` sowie in der `ASSETS`-Liste
  von `sw.js`

Die Versionsparameter sorgen dafür, dass auch der normale HTTP-Cache des
Browsers (z. B. bei `python -m http.server`) die neuen Dateien liefert – ohne
`?v=` kann dort trotz gelöschtem Service-Worker-Cache eine alte Fassung
hängen bleiben.

Zum Testen im Browser:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
```

Danach die Seite neu laden.

## Debug

`window.__fahrt = { map, state, store }` ist für schnelle Prüfungen in der
Konsole exponiert (Zoom, Trip-Punkte, Auswahlzustand, Fahrtenarchiv). Vor einer
öffentlichen Auslieferung kann die Zeile in `js/app.js` entfernt werden.

## Lizenz und Attribution

- Kartendaten: © OpenStreetMap-Mitwirkende, lizenziert unter
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/). Die Attribution ist in
  der Legende und der Leaflet-Attribution sichtbar und muss erhalten bleiben.
- [Leaflet](https://leafletjs.com/) 1.9.4, BSD-2-Clause, lokal in `vendor/`.
- Der Anwendungscode in diesem Ordner ist ein privates Projekt ohne festgelegte
  Lizenz.
