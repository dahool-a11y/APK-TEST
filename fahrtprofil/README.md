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
Fahrt Riga – Sigulda – Cēsis, damit Karte, Kurve und Auswahl sofort sichtbar
sind.

## Was die App kann

- **Offline-Karte**: gebündelte OSM-Vektordaten für Lettland
  (`data/basemap.js`, ~2,6 MB) werden von einem eigenen Leaflet-`GridLayer` in
  Canvas gezeichnet. Meer, Landflächen, Staatsgrenzen, Straßen, Flüsse, Seen,
  Bahnstrecken und Ortslabels sind enthalten; es gibt keine Netzwerkanfragen an
  Karten-Server.
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
  Fahrt lässt sich öffnen, bearbeiten oder löschen.
- **Fahrtenbuch-Werkzeuge**: Suche, Filter (GPS, Import, Simuliert, OBD),
  Sortierung (neueste, Strecke, Verbrauch, Name), Umbenennen und Notizen je
  Fahrt sowie eine Gesamtsicherung aller Fahrten als eine JSON-Datei
  (Export und Wiederherstellung).
- **Diagnose (OBD-II/CAN)**: eigener ELM327-Client mit Demo-, Android-Bridge-,
  USB-Serial- und Bluetooth-Transport, Live-Kacheln, Verbrauchsverlauf,
  Fehlercodes lesen/löschen, PID-Scan, CSV-Log und Vollbild-HUD.
- **Gemessener Verbrauch**: Mit verbundenem Adapter werden Drehzahl,
  Kühlmittel, Motorlast, Drosselklappe, Luftmasse und Verbrauch an jedem
  GPS-Punkt mitgespeichert. Die Fahrt ist danach als „OBD“ markiert, der
  Verbrauch gilt als gemessen statt geschätzt.
- **Import**: GPX, CSV und JSON über „Daten laden“; Sicherungen mit mehreren
  Fahrten über „Sicherung importieren“.
- **Export**: aktuelle Fahrt als JSON, alle Fahrten als Sicherung.
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
- Schlechte Genauigkeit wird verworfen: über 80 m während der Fahrt, über 65 m
  beim ersten Fix. Bewegungen unterhalb der Genauigkeit (Drift im Stand) zählen
  nicht zur Strecke. Ein Sprung über ~200 km/h zwischen zwei Fixes wird
  ignoriert. Standzeiten ab 12 s werden erkannt und im Diagramm markiert.

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
- **OBD**: Die Diagnose-Seite nutzt in der App den Transport „Android“. Die
  native Seite muss dafür vier Funktionen als `AndroidBridge` bereitstellen
  (siehe unten); ohne sie bleibt der Knopf deaktiviert.
- **Updates**: Die App fragt beim Start die GitHub-Release `latest` ab und zeigt nur
  bei einer neueren Version ein Banner mit „Herunterladen und installieren“.
- **Service Worker**: in der App deaktiviert (alles liegt ohnehin lokal).
- **Paket-ID**: bleibt `de.blumenthalmedia.balltest`, damit die App die frühere
  Ball-Test-App ersetzt.
- Jeder Push auf `main` baut per GitHub Actions eine neue APK.

### OBD-Bridge für die Android-App

`js/obd.js` erwartet im Android-Transport diese vier Funktionen auf
`window.AndroidBridge` (Rückgaben als String, Aufrufe dürfen blockieren oder
ein Promise liefern):

| Funktion | Aufgabe |
| --- | --- |
| `obdDevices()` | Liste gekoppelter Adapter als JSON: `[{"id":"…","name":"ELM327 …"}]` |
| `obdConnect(id)` | Verbindung öffnen, Erfolg als `true`/`"ok"` |
| `obdSend(cmd)` | Einen ELM327-Befehl senden, Antwort bis `>` zurückgeben |
| `obdDisconnect()` | Verbindung schließen |

Die native Seite öffnet den Bluetooth-SPP-Socket (klassisches ELM327) und
reicht die Befehle unverändert durch. Das Protokoll (Init, PIDs, DTC, Polling)
liegt vollständig in `js/obd.js`; die App muss nur Bytes transportieren.

### Fahrzeug-Layout (`car.css`)

Im Querformat ab 700 px Breite greift `car.css` (nach `styles.css` geladen): Schrift
mindestens 12–13 px (Werte 16–54 px), Knöpfe mindestens 48 px, große Zoom-Knöpfe,
Diagrammschrift skaliert über `--cf`. Zwei Anordnungen:

- **Standard** (z. B. 1024×600, 1280×720): Karte und Diagramm links, Kennzahlen rechts.
- **Flach/breit** (z. B. 1280×480, 1920×720, 800×480): Karte links, rechts oben die
  Kennzahlen, darunter Diagramm und Wiedergabeleiste.

Getestet mit Chromium in 844×390, 800×480, 960×540, 1024×600, 1280×480, 1280×720 und
1920×720 (Hauptansicht, ausgewählter Punkt, Aufzeichnung, Fahrtenliste): keine
Überläufe, keine überlappenden Karten, alle Knöpfe ≥ 44 px. Echte Radios können
andere Pixeldichten melden; falls etwas nicht passt, die gemeldete Auflösung nennen.

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
  Bearbeiten- und Löschknopf 46–52 px. Der Ausgang ist als „Zur Karte“
  beschriftet.
- **Suchen und filtern**: Das Suchfeld prüft Name, Notiz, Quelle und Datum.
  Filter: Alle, GPS, Import, Simuliert, OBD. Sortierung: Neueste zuerst,
  Größte Strecke, Höchster Verbrauch, Name A–Z.
- **Bearbeiten**: Stift-Symbol öffnet einen Editor für Name und Notiz
  (max. 80 bzw. 400 Zeichen); beides erscheint in der Liste und im Tooltip.
- **Öffnen**: Klick auf eine Zeile lädt die Fahrt mit Karte, Kurve und
  Wiedergabe. Die zuletzt geöffnete Fahrt ist in der Liste markiert.
- **Löschen**: Papierkorb-Symbol mit Rückfrage; die Aufzeichnung wird dauerhaft
  aus dem Gerät entfernt.
- **Sicherung**: Die beiden Symbole rechts in der Werkzeugleiste exportieren
  alle Fahrten in eine Datei `fahrtprofil-sicherung-JJJJ-MM-TT.json`
  (`kind: "fahrtprofil-backup"`) und lesen sie wieder ein. Bei alten Sicherungen
  fehlende Felder (OBD, Notizen, Standzeiten) werden ergänzt; eine defekte Fahrt
  stoppt den Import nicht.
- **Achtung**: Beim Löschen der Website-Daten im Browser verschwindet auch das
  Archiv. Wichtige Fahrten vorher exportieren.

## Verbrauch: geschätzt vs. gemessen

Bei GPS-Aufnahmen und GPX-Importen liegen ohne Adapter keine
Momentanverbräuche vor. Der Verbrauch wird dann aus Tempo, Steigung und
Fahrmodus geschätzt und in der Oberfläche klar als **„Verbrauch geschätzt“**
gekennzeichnet. Der Ø-Verbrauch wird als `getankte Liter / gefahrene km * 100`
berechnet, nicht als Mittel der Punktwerte.

Echte Werte lassen sich über CSV/JSON mitliefern (`cons` je Punkt). Ist auf der
Diagnose-Seite ein OBD-Adapter verbunden, werden die Messwerte beim Aufzeichnen
direkt an jeden GPS-Punkt geschrieben (`consSrc: "obd"`). Die Fahrt erhält das
OBD-Kennzeichen, die Detailkarte zeigt zusätzlich Drehzahl und Kühlmittel, und
die Schätzung entfällt für diese Punkte.

Die Quellen werden je Punkt gespeichert: `obd` (gemessen), `file` (aus der
Importdatei) und `estimate` (geschätzt). Überwiegen geschätzte Punkte oder
fehlen Messwerte ganz, trägt die Fahrt den Vermerk „Verbrauch geschätzt“.

## Datenformate

### JSON

```json
{
  "kind": "fahrtprofil-trip",
  "name": "Fahrt zur Arbeit",
  "date": "2026-10-29T07:12:00Z",
  "notes": "Trocken, Beladung 1 Person",
  "obd": true,
  "consSource": "obd",
  "points": [
    {
      "lat": 56.9517, "lng": 24.1133, "ele": 10, "speed": 32,
      "cons": 6.4, "consSrc": "obd", "time": 1761721920,
      "rpm": 1420, "coolant": 82, "load": 24, "throttle": 12, "fuel": 3.1
    }
  ]
}
```

`points` ist Pflicht. `cons` (L/100 km) ist optional, ebenso `speed` (km/h),
`ele` (m), `time` (Unix-Sekunden oder ISO-String) und `dist` (m). Die
OBD-Felder `rpm`, `coolant`, `load`, `throttle`, `fuel` und `consSrc` sind
optional; fehlen sie, wird der Verbrauch geschätzt.

### Sicherung

Eine Gesamtsicherung enthält mehrere Fahrten in einer Datei:

```json
{
  "kind": "fahrtprofil-backup",
  "version": 2,
  "exportedAt": "2026-11-03T17:00:00Z",
  "trips": [ { "name": "…", "meta": { … }, "stats": { … }, "stops": [ … ], "points": [ … ] } ]
}
```

Der Import erkennt das Format am `kind` und speichert jede Fahrt einzeln. Einzelne
Fahrtdateien (`kind: "fahrtprofil-trip"`) und GPX/CSV funktionieren weiterhin
über „Daten laden“.

### CSV

Trennzeichen `;` oder `,` wird automatisch erkannt, Dezimalkomma ist erlaubt.
Spaltennamen sind tolerant (Groß-/Kleinschreibung, Umlaute):

```csv
lat;lng;ele;speed;cons;time
56.9517;24.1133;10;32;6.4;2026-10-29T07:12:00Z
```

Erkannte Aliase sind u. a. `lat|latitude|breite`, `lng|lon|longitude|laenge`,
`ele|hoehe|altitude`, `speed|tempo|kmh`, `cons|verbrauch|l100km|fuel`,
`time|zeit|timestamp`, `dist|strecke|distanz`.

### GPX

Standard-GPX mit `trkpt`, optional `ele` und `time`. Der Verbrauch wird
geschätzt.

## OBD-II / CAN: Diagnose

Die Seite **Diagnose** (vierter Reiter) spricht ELM327-Adapter direkt an. Der
Client liegt in `js/obd.js`, die Oberfläche in `js/diag.js`.

### Verbindungsarten

| Knopf | Transport | Voraussetzung |
| --- | --- | --- |
| **Demo** | simulierter ELM327 v1.5 | keine; liefert plausible Livewerte, Drehzahl, Kühlmittel und den Fehlercode `P0133` |
| **Android** | native Brücke (`AndroidBridge`) | installierte APK mit `obdDevices()`, `obdConnect(id)`, `obdSend(cmd)`, `obdDisconnect()` |
| **USB** | Web Serial | Chrome/Edge, HTTPS oder localhost, USB-ELM327 |
| **Bluetooth** | Web Bluetooth (BLE) | Chrome/Edge, HTTPS oder localhost, BLE-Adapter; klassische SPP-Adapter nur über die Android-Brücke |

Baudrate: 38400 (Standard), 9600, 115200 oder 500000. Die Initialisierung
sendet `ATZ`, `ATE0`, `ATL0`, `ATS1`, `ATH0`, `ATSP0`, `ATI`; jede Antwort wird
bis zum Prompt `>` gelesen.

### Livewerte und Verbrauch

Angezeigt werden Tempo, Drehzahl, Kühlmittel, Motorlast, Drosselklappe,
Luftmasse, Saugrohrdruck und Bordspannung, dazu eine Sparkline des
Momentanverbrauchs. Der Verbrauch kommt aus der Kraftstoffrate (PID `0x5E`) oder
ersatzweise aus der Luftmasse; meldet das Fahrzeug beides nicht, dient die
Motorlast als grobe Näherung:

```
L/h = (MAF g/s / 14.7) * 3600 / 745
L/100 km = L/h / km/h * 100
```

Im Stand (unter 3 km/h) zeigt die Kachel „–“, weil L/100 km dort nicht
aussagekräftig ist.

### Fehlercodes, Scan, Log

- **Lesen** holt `0101` (MIL-Status) und `03` (DTCs); **Löschen** sendet `04`.
- **PIDs scannen** prüft die unterstützten PID-Sätze `0100`, `0120`, `0140`.
- **Log starten** schreibt alle gepollten Werte mit Zeitstempel in eine CSV
  (`obd-log-JJJJ-MM-TT-HH-MM.csv`); in der Android-App über das Teilen-Menü.
- Die Konsole zeigt jeden gesendeten Befehl und die rohe Antwort; das Eingabefeld
  erlaubt eigene Befehle (z. B. `0100`).

### HUD

Der Knopf **HUD** (oder Taste `H`) öffnet ein Vollbild-Display mit Tempo,
Verbrauch, Drehzahl und Kühlmittel, ideal für das Radio im Auto. Antippen oder
`Esc` schließt es; `Esc` schließt zuerst nur das HUD, nicht die Diagnose-Seite.

### Messwerte in Fahrten

Beim Aufzeichnen fragt `js/app.js` bei jedem GPS-Punkt den letzten OBD-Schnappschuss
ab und speichert `rpm`, `coolant`, `load`, `throttle`, `fuel` und – bei Tempo über
3 km/h – `cons` samt `consSrc: "obd"`. Damit sind spätere Auswertungen ohne
Adapter reproduzierbar.

## Projektstruktur

```
fahrtprofil/
  index.html              Layout, Seiten (Tracking, Fahrtenbuch, Diagnose, Service), HUD, Editor
  styles.css              Grundstyling
  car.css                 Fahrzeug-Layout (Querformat ab 700 px)
  nav.css                 Seitenmenü und Servicebuch
  diag.css                Diagnose, HUD, Fahrtenbuch-Werkzeuge, Editor
  js/app.js               Karte, Chart, Auswahl, GPS, PWA, Fahrtenbuch-Tools, Sicherung
  js/simulate.js          Simulation + TripSim.finalize() für Importe
  js/data.js              Importadapter für JSON, CSV, GPX und Sicherungen
  js/store.js             Fahrtenarchiv (IndexedDB, Fallback localStorage)
  js/obd.js               ELM327-Client (Demo, Android-Bridge, Web Serial, Web Bluetooth)
  js/diag.js              Diagnose-Seite, Livewerte, DTC, Log, HUD
  js/service.js           Servicebuch (Fristen, Kilometerstand)
  js/nav.js               Navigation zwischen den vier Ansichten
  js/native-bridge.js     GPS-Brücke für die Android-App
  js/basemap.js           Offline-Vektorlayer und Ortslabels
  data/basemap.js         gebündelte OSM-Geometrie (ODbL)
  vendor/                 lokales Leaflet 1.9.4
  sw.js                   Offline-Cache
  manifest.webmanifest    PWA-Manifest
  icons/                  PWA-Icons
  tools/build_basemap.py  erzeugt data/basemap.js aus Geofabrik-PBF + Natural Earth
  tools/make_icons.py     erzeugt die PWA-Icons
```

## Karte neu bauen

`tools/build_basemap.py` liest einen Geofabrik-Auszug (`.osm.pbf`), vereinfacht
die Geometrien und schreibt `data/basemap.js`. Meer, Landflächen und
Staatsgrenzen kommen aus Natural Earth 1:10m (gemeinfrei), alles andere aus
OpenStreetMap. Enthalten sind `motorway`, `trunk`, `primary` und `secondary`,
Bahnstrecken, Flüsse, Seen ab 0,25 km² sowie Orte vom Typ `city` und `town`.

```powershell
pip install osmium pyshp
python tools\build_basemap.py `
  --pbf latvia-latest.osm.pbf `
  --countries ne_10m_admin_0_countries.shp
```

Der Lauf dauert einige Minuten, weil der PBF zweimal gelesen wird (erst die
Wasser-Relationen, dann alle Wege mit Koordinaten). Mit `--out` lässt sich ein
anderer Zielpfad angeben; ohne `--countries` entfallen Land und Grenzen.

## Service Worker / Updates

`sw.js` cached die App-Shell mit Cache-Namen `fahrtprofil-v41`. Navigationen
werden **network-first** geladen (offline aus dem Cache), statische Assets aus
dem Cache mit Hintergrund-Aktualisierung. Der Precache nutzt `cache: 'reload'`
und umgeht damit den HTTP-Cache, der sonst eine alte `index.html` liefern
könnte. Nach Änderungen an HTML, CSS, JS oder Kartendaten **beides gemeinsam**
erhöhen:

- `CACHE` in `sw.js` (z. B. `fahrtprofil-v40`)
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
Konsole exponiert (Zoom, Trip-Punkte, Auswahlzustand, Fahrtenarchiv). Dazu
kommen `FahrtApp` (GPS-Livewerte, Fahrten neu laden), `TripStore`
(`list/get/save/remove/updateMeta/all`), `TripSim`, `TripData`, `FahrtOBD`
(Verbindung, Schnappschuss, Log), `FahrtDiag` (Seite, HUD) und `FahrtNav`.
Vor einer öffentlichen Auslieferung kann die `__fahrt`-Zeile in `js/app.js`
entfernt werden.

## Lizenz und Attribution

- Kartendaten: © OpenStreetMap-Mitwirkende, lizenziert unter
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/). Die Attribution ist in
  der Legende und der Leaflet-Attribution sichtbar und muss erhalten bleiben.
- [Leaflet](https://leafletjs.com/) 1.9.4, BSD-2-Clause, lokal in `vendor/`.
- Der Anwendungscode in diesem Ordner ist ein privates Projekt ohne festgelegte
  Lizenz.

## Navigation, Fahrtenbuch und Diagnose (Version 41)

- Vier Reiter in der Seitenleiste (mobil unten): **Tracking** (Karte und Aufzeichnung), **Fahrtenbuch** (gespeicherte Fahrten), **Diagnose** (OBD-II/CAN) und **Service**. Die Zurück-Taste führt aus den Seiten zum Tracking; `Esc` schließt zuerst HUD bzw. Editor.
- **Service** (`js/service.js`): Tachostand einmal eintragen, danach zählt die App gespeicherte Fahrten dazu. Vier Fristen: Ölwechsel (km und Monate), CSDD-Prüfung, Ölstand-Kontrolle, Wischwasser-Kontrolle. Jede Zeile zeigt Symbol, großen Restwert mit Einheit und eine leise Detailzeile; kleine Icon-Buttons daneben erledigen „abgehakt“ und „bearbeiten“. Ampel grün, gelb (bald fällig), rot (fällig) über Statuspunkt, linke Kante und Fortschrittsbalken; der Zähler am Reiter zeigt, wie viele Fristen anstehen.
- Alle Service-Daten liegen im localStorage unter `fahrtprofil.service.v1`, nur lokal.
- **Diagnose** (`js/diag.js`, `js/obd.js`): Live-Kacheln, Verbrauchs-Sparkline, DTC lesen/löschen, PID-Scan, Konsole, CSV-Log und HUD. Ohne Hardware lässt sich alles im Demo-Modus prüfen.
- **HUD**: Vollbild für das Fahrzeugdisplay, Taste `H`; Antippen oder `Esc` schließt es.
- Navigation: `js/nav.js`, Stil: `nav.css`; Diagnose-spezifische Stile: `diag.css`.
