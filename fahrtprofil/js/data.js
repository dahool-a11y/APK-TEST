/* Fahrtprofil – Import echter Fahrtdaten
 * Unterstützt JSON, CSV und GPX. Verbrauch kann mitgeliefert werden;
 * fehlt er (z. B. bei GPX), wird er aus Tempo/Steigung geschätzt und markiert.
 */
(function () {
  'use strict';

  function normalizeKey(k) {
    return String(k)
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  const ALIASES = {
    lat: ['lat', 'latitude', 'breite', 'breitengrad', 'y'],
    lng: ['lng', 'lon', 'long', 'longitude', 'laenge', 'laengengrad', 'x'],
    ele: ['ele', 'elevation', 'altitude', 'hoehe', 'height', 'z'],
    speed: ['speed', 'geschwindigkeit', 'tempo', 'kmh', 'v', 'velocity'],
    cons: ['cons', 'consumption', 'verbrauch', 'l100km', 'liter100km', 'fuel', 'verbrauchl100km'],
    time: ['time', 'timestamp', 'zeit', 't', 'datetime', 'datum'],
    dist: ['dist', 'distance', 'strecke', 'distanz', 'm']
  };

  function pick(row, field) {
    for (const key of ALIASES[field]) {
      if (row[key] !== undefined && row[key] !== '') return row[key];
    }
    return undefined;
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(',', '.').replace(/[^\d.+\-eE]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function parseTime(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v > 1e11 ? v / 1000 : v;
    const s = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      return n > 1e11 ? n / 1000 : n;
    }
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }

  function splitCsvLine(line, delim) {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (c === delim && !quoted) {
        out.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text, fileName) {
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) throw new Error('CSV enthält keine Datenzeilen.');
    const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
    const header = splitCsvLine(lines[0], delim).map(normalizeKey);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i], delim);
      const row = {};
      header.forEach((h, idx) => { row[h] = cells[idx]; });
      const lat = num(pick(row, 'lat'));
      const lng = num(pick(row, 'lng'));
      if (lat === null || lng === null) continue;
      const point = { lat, lng };
      const ele = num(pick(row, 'ele'));
      const speed = num(pick(row, 'speed'));
      const cons = num(pick(row, 'cons'));
      const time = parseTime(pick(row, 'time'));
      const dist = num(pick(row, 'dist'));
      if (ele !== null) point.ele = ele;
      if (speed !== null) point.speed = speed;
      if (cons !== null) point.cons = cons;
      if (time !== null) point.time = time;
      if (dist !== null) point.dist = dist;
      rows.push(point);
    }
    if (rows.length < 2) throw new Error('Keine gültigen Zeilen mit lat/lng gefunden.');
    return TripSim.finalize(rows, {
      name: fileName.replace(/\.[^.]+$/, ''),
      source: 'import',
      label: 'CSV-Import',
      fileName
    });
  }

  function parseJSON(text, fileName) {
    let obj = JSON.parse(text);
    let points = Array.isArray(obj) ? obj : obj.points;
    if (!Array.isArray(points)) throw new Error('JSON benötigt ein Feld "points" mit GPS-Punkten.');
    const rows = points.map((p) => {
      const row = {};
      Object.keys(p).forEach((k) => { row[normalizeKey(k)] = p[k]; });
      const out = {
        lat: num(pick(row, 'lat')),
        lng: num(pick(row, 'lng'))
      };
      const ele = num(pick(row, 'ele'));
      const speed = num(pick(row, 'speed'));
      const cons = num(pick(row, 'cons'));
      const time = parseTime(pick(row, 'time'));
      const dist = num(pick(row, 'dist'));
      if (ele !== null) out.ele = ele;
      if (speed !== null) out.speed = speed;
      if (cons !== null) out.cons = cons;
      if (time !== null) out.time = time;
      if (dist !== null) out.dist = dist;
      if (p.phase) out.phase = p.phase;
      return out;
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (rows.length < 2) throw new Error('Keine gültigen Koordinaten im JSON gefunden.');
    return TripSim.finalize(rows, {
      name: (obj && obj.name) || fileName.replace(/\.[^.]+$/, ''),
      source: 'import',
      label: 'JSON-Import',
      fileName,
      date: (obj && obj.date) || null
    });
  }

  function parseGPX(text, fileName) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('GPX konnte nicht gelesen werden.');
    const nodes = doc.getElementsByTagName('trkpt');
    const rows = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const lat = num(node.getAttribute('lat'));
      const lng = num(node.getAttribute('lon'));
      if (lat === null || lng === null) continue;
      const eleNode = node.getElementsByTagName('ele')[0];
      const timeNode = node.getElementsByTagName('time')[0];
      rows.push({
        lat,
        lng,
        ele: eleNode ? num(eleNode.textContent) : null,
        time: timeNode ? parseTime(timeNode.textContent) : null
      });
    }
    if (rows.length < 2) throw new Error('GPX enthält keine Trackpunkte.');
    const nameNode = doc.querySelector('trk > name') || doc.querySelector('metadata > name');
    return TripSim.finalize(rows, {
      name: nameNode ? nameNode.textContent.trim() : fileName.replace(/\.[^.]+$/, ''),
      source: 'import',
      label: 'GPX-Import',
      fileName
    });
  }

  async function loadFile(file) {
    const text = await file.text();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'json') return parseJSON(text, file.name);
    if (ext === 'csv' || ext === 'txt') return parseCSV(text, file.name);
    if (ext === 'gpx') return parseGPX(text, file.name);
    throw new Error('Unbekanntes Format. Bitte JSON, CSV oder GPX laden.');
  }

  window.TripData = { loadFile };
})();
