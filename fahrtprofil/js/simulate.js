/* Fahrtprofil – Routen- und Verbrauchssimulation
 * Erzeugt eine plausible Fahrt (GPS-Punkte, Höhenprofil, Tempo, Verbrauch).
 * Später können echte Daten über data.js importiert werden.
 */
(function () {
  'use strict';

  // lat, lng, Höhe (m), Zieltempo (km/h), Abschnitt
  const WAYPOINTS = [
    [56.9517, 24.1133, 10, 0,   'Stadt'],       // Riga, Freiheitsdenkmal
    [56.9535, 24.1350, 10, 30,  'Stadt'],
    [56.9552, 24.1560, 11, 38,  'Stadt'],
    [56.9570, 24.1780, 12, 42,  'Stadt'],
    [56.9592, 24.2000, 13, 48,  'Stadt'],
    [56.9620, 24.2250, 15, 50,  'Stadt'],
    [56.9655, 24.2520, 16, 55,  'Stadt'],
    [56.9700, 24.2800, 18, 62,  'Stadt'],
    [56.9748, 24.3080, 20, 70,  'Landstraße'],  // Berģi
    [56.9860, 24.3400, 23, 82,  'Landstraße'],
    [57.0050, 24.3700, 26, 90,  'Landstraße'],
    [57.0280, 24.3980, 29, 96,  'Landstraße'],  // Garkalne
    [57.0500, 24.4400, 33, 100, 'Autobahn'],
    [57.0700, 24.4800, 37, 104, 'Autobahn'],
    [57.0850, 24.5200, 41, 106, 'Autobahn'],    // Vangaži
    [57.0980, 24.5700, 46, 104, 'Autobahn'],
    [57.1080, 24.6200, 52, 100, 'Autobahn'],
    [57.1180, 24.6700, 60, 92,  'Landstraße'],
    [57.1280, 24.7150, 68, 86,  'Landstraße'],  // Inciems
    [57.1380, 24.7600, 76, 82,  'Landstraße'],
    [57.1460, 24.8000, 86, 74,  'Landstraße'],
    [57.1520, 24.8380, 94, 60,  'Stadt'],       // Sigulda
    [57.1545, 24.8560, 96, 48,  'Stadt'],
    [57.1600, 24.8730, 96, 55,  'Stadt'],
    [57.1700, 24.8900, 94, 66,  'Landstraße'],
    [57.1820, 24.9150, 90, 74,  'Landstraße'],
    [57.1950, 24.9450, 85, 78,  'Landstraße'],
    [57.2060, 24.9750, 80, 80,  'Landstraße'],
    [57.2160, 25.0050, 76, 78,  'Landstraße'],
    [57.2260, 25.0360, 72, 74,  'Landstraße'],  // Līgatne
    [57.2350, 25.0650, 68, 70,  'Landstraße'],
    [57.2440, 25.0950, 72, 72,  'Landstraße'],
    [57.2540, 25.1250, 80, 76,  'Landstraße'],
    [57.2650, 25.1550, 88, 78,  'Landstraße'],
    [57.2760, 25.1900, 94, 74,  'Landstraße'],
    [57.2880, 25.2200, 98, 66,  'Landstraße'],
    [57.2990, 25.2450, 100, 56, 'Stadt'],
    [57.3080, 25.2650, 101, 46, 'Stadt'],
    [57.3128, 25.2749, 100, 0,  'Stadt']        // Cēsis
  ];

  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function haversine(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smooth(arr, radius, passes) {
    let a = arr.slice();
    passes = passes || 1;
    for (let p = 0; p < passes; p++) {
      const b = new Array(a.length);
      for (let i = 0; i < a.length; i++) {
        let sum = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const j = clamp(i + k, 0, a.length - 1);
          sum += a[j];
          n++;
        }
        b[i] = sum / n;
      }
      a = b;
    }
    return a;
  }

  // Empirisches Verbrauchsmodell (L/100 km) aus Tempo, Steigung und Beschleunigung.
  // Bewusst so kalibriert, dass Stadt, Autobahn und Bergpass sichtbare Unterschiede zeigen.
  function estimateConsumption(speedKmh, gradePct, accel, rand) {
    const v = speedKmh / 3.6;
    let base =
      4.9 +
      (v < 22.2 ? 0.006 * (22.2 - v) ** 2 : 0.0032 * (v - 22.2) ** 2) +
      2.4 * Math.exp(-v / 2.8);

    let grade = 95 * (gradePct / 100);
    if (gradePct < 0) grade *= 1.2;

    let acc = accel > 0 ? 2.3 * accel : 0.9 * accel;
    let cons = base + grade + acc + (rand ? (rand() - 0.5) * 0.5 : 0);
    if (speedKmh < 1.5) cons = 0;
    return clamp(cons, 0, 30);
  }

  function bearing(a, b) {
    const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    const x =
      Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
      Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  function buildStats(points, meta) {
    const totalDist = points[points.length - 1].dist;
    let fuel = 0;
    for (let i = 1; i < points.length; i++) {
      const ds = points[i].dist - points[i - 1].dist;
      fuel += ((points[i].cons + points[i - 1].cons) / 2 / 100) * (ds / 1000);
    }
    let maxCons = 0, maxSpeed = 0, maxRpm = 0, maxCoolant = 0, obdPoints = 0;
    for (const p of points) {
      if (p.cons > maxCons) maxCons = p.cons;
      if (p.speed > maxSpeed) maxSpeed = p.speed;
      if (p.rpm > maxRpm) maxRpm = p.rpm;
      if (p.coolant > maxCoolant) maxCoolant = p.coolant;
      if (p.consSrc === 'obd' || p.obd) obdPoints++;
    }
    const duration = points[points.length - 1].time;
    const avgCons = totalDist > 1 ? (fuel / (totalDist / 1000)) * 100 : 0;
    return {
      totalDist,
      duration,
      avgCons: isFinite(avgCons) ? avgCons : 0,
      maxCons,
      maxSpeed,
      avgSpeed: duration > 0 ? totalDist / 1000 / (duration / 3600) : 0,
      fuel,
      obdPoints,
      maxRpm,
      maxCoolant
    };
  }

  // Hält an, wenn das Tempo länger als 12 s unter 2,5 km/h liegt.
  // Solche Standzeiten bekommen im Diagramm eine eigene Markierung.
  function detectStops(points) {
    const stops = [];
    let i = 1;
    while (i < points.length) {
      if (points[i].speed >= 2.5) { i++; continue; }
      let start = i;
      let end = i;
      while (end + 1 < points.length && points[end + 1].speed < 2.5) end++;
      const dwell = points[end].time - points[start].time;
      if (dwell >= 12) {
        stops.push({
          idx: Math.round((start + end) / 2),
          dist: Math.round(points[start].dist * 10) / 10,
          dwell: Math.round(dwell)
        });
      }
      i = end + 1;
    }
    return stops;
  }

  function buildSimulation(seed) {
    const rand = mulberry32(seed || Date.now());
    const wps = WAYPOINTS.map((w) => ({
      lat: w[0], lng: w[1], ele: w[2], target: w[3], phase: w[4]
    }));

    // 1) Route verdichten (~45 m Abstand)
    let pts = [];
    for (let s = 0; s < wps.length - 1; s++) {
      const a = wps[s], b = wps[s + 1];
      const n = Math.max(1, Math.ceil(haversine(a, b) / 45));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push({
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
          ele: a.ele + (b.ele - a.ele) * t,
          target: a.target + (b.target - a.target) * t,
          phase: a.phase
        });
      }
    }
    pts.push({ ...wps[wps.length - 1] });

    // 2) Kurven glätten (GPS-Rauschen / runde Straßenverläufe)
    const lats = smooth(pts.map((p) => p.lat), 2, 2);
    const lngs = smooth(pts.map((p) => p.lng), 2, 2);
    for (let i = 0; i < pts.length; i++) {
      pts[i].lat = lats[i];
      pts[i].lng = lngs[i];
    }

    // 3) Streckenlänge
    let dist = 0;
    pts[0].dist = 0;
    for (let i = 1; i < pts.length; i++) {
      dist += haversine(pts[i - 1], pts[i]);
      pts[i].dist = dist;
    }
    const total = dist;

    // 4) Höhenprofil inkl. leichter Unebenheiten
    let eles = pts.map(
      (p, i) => p.ele + 1.1 * Math.sin(p.dist / 820 + 1.7) + 0.5 * Math.sin(p.dist / 260)
    );
    eles = smooth(eles, 4, 2);
    const n = pts.length;
    const grade = eles.map((e, i) => {
      const a = Math.max(0, i - 4);
      const b = Math.min(n - 1, i + 4);
      const ds = pts[b].dist - pts[a].dist;
      return ds > 1 ? ((eles[b] - eles[a]) / ds) * 100 : 0;
    });
    const grades = smooth(grade, 3, 1).map((g) => clamp(g, -14, 14));

    // 5) Tempo: Zieltempo + Verkehrswellen
    let sp = smooth(pts.map((p) => p.target), 4, 2);
    sp = sp.map(
      (v, i) => v * (1 + 0.04 * Math.sin(pts[i].dist / 700 + 1.2) + 0.025 * Math.sin(pts[i].dist / 230 + 0.4))
    );

    // 6) Stopps (Ampeln / Kreuzungen)
    const fractions = [0.018, 0.052, 0.088, 0.405, 0.635, 0.945];
    const dwells = [18, 22, 26, 20, 28, 24];
    const stops = [];
    for (let s = 0; s < fractions.length; s++) {
      let idx = 0, best = Infinity;
      const target = total * fractions[s];
      for (let i = 0; i < n; i++) {
        const d = Math.abs(pts[i].dist - target);
        if (d < best) { best = d; idx = i; }
      }
      let guard = 0;
      while (pts[idx].phase === 'Autobahn' && guard < 30) { idx = Math.max(1, idx - 5); guard++; }
      stops.push({ idx, dist: pts[idx].dist, dwell: dwells[s] });
    }

    for (const st of stops) {
      for (let i = 0; i < n; i++) {
        const dd = Math.abs(pts[i].dist - st.dist);
        if (dd < 260) sp[i] = Math.min(sp[i], Math.sqrt(2 * 1.35 * dd) * 3.6);
      }
      sp[st.idx] = 0;
    }

    const stopAt = new Map(stops.map((s) => [s.idx, s]));

    // 7) Zeitstempel
    let t = 0;
    pts[0].time = 0;
    for (let i = 1; i < n; i++) {
      const ds = pts[i].dist - pts[i - 1].dist;
      const vAvg = Math.max(1.0, ((sp[i] + sp[i - 1]) / 2) / 3.6);
      t += ds / vAvg;
      const st = stopAt.get(i);
      if (st) t += st.dwell;
      pts[i].time = t;
    }

    // 8) Beschleunigung
    const accels = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const dt = pts[i + 1].time - pts[i - 1].time;
      if (dt > 0.05) {
        accels[i] = ((sp[i + 1] - sp[i - 1]) / 3.6) / dt;
      }
    }
    const accS = smooth(accels, 1, 1).map((a) => clamp(a, -3.5, 3.5));

    // 9) Verbrauch
    let cons = pts.map((p, i) => estimateConsumption(sp[i], grades[i], accS[i], rand));
    cons = smooth(cons, 1, 1);

    // 10) Punkte zusammensetzen
    for (let i = 0; i < n; i++) {
      pts[i].ele = eles[i];
      pts[i].grade = grades[i];
      pts[i].speed = sp[i];
      pts[i].cons = cons[i];
      pts[i].accel = accS[i];
      pts[i].consSrc = 'estimate';
      pts[i].bearing = bearing(pts[i], pts[Math.min(n - 1, i + 3)] || pts[i]);
    }

    const stats = buildStats(pts, {});
    const date = new Date();
    const trip = {
      name: 'Riga – Sigulda – Cēsis',
      meta: {
        source: 'simulation',
        date: date.toISOString(),
        seed,
        label: 'Simulation',
        estimatedCons: true,
        consSource: 'estimate'
      },
      points: pts,
      stats
    };
    trip.stops = stops;
    return trip;
  }

  // Echte Daten (GPX/CSV/JSON) vereinheitlichen und fehlende Werte ableiten.
  function finalize(raw, meta) {
    meta = meta || {};
    if (!raw || raw.length < 2) throw new Error('Zu wenige GPS-Punkte in der Datei.');

    const num = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const pts = raw.map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      ele: num(p.ele),
      speed: num(p.speed),
      cons: num(p.cons),
      time: num(p.time),
      dist: num(p.dist),
      phase: p.phase || null,
      rpm: num(p.rpm),
      coolant: num(p.coolant),
      load: num(p.load),
      throttle: num(p.throttle),
      fuel: num(p.fuel),
      consSrc: p.consSrc || null,
      obd: !!p.obd
    })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (pts.length < 2) throw new Error('Keine gültigen Koordinaten gefunden.');
    const n = pts.length;
    const firstAbs = pts.find((p) => p.time !== null && p.time > 1e9);
    // Zeitwert festhalten: die Punkte werden unten auf t0 = 0 normalisiert.
    const firstAbsTime = firstAbs ? firstAbs.time : null;

    // Distanz
    const hasDist = pts.every((p) => p.dist !== null);
    if (!hasDist) {
      pts[0].dist = 0;
      for (let i = 1; i < n; i++) pts[i].dist = pts[i - 1].dist + haversine(pts[i - 1], pts[i]);
    }

    // Zeit
    const hasTime = pts.every((p) => p.time !== null);
    if (!hasTime) {
      let t = 0;
      pts[0].time = 0;
      for (let i = 1; i < n; i++) {
        const ds = Math.max(0, pts[i].dist - pts[i - 1].dist);
        const v = Math.max(8, pts[i].speed || pts[i - 1].speed || 50) / 3.6;
        t += ds / v;
        pts[i].time = t;
      }
    } else {
      const t0 = pts[0].time;
      for (const p of pts) p.time -= t0;
      for (let i = 1; i < n; i++) {
        if (pts[i].time <= pts[i - 1].time) pts[i].time = pts[i - 1].time + 0.2;
      }
    }

    // Tempo
    for (let i = 0; i < n; i++) {
      if (pts[i].speed === null) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        const dt = pts[b].time - pts[a].time;
        const ds = pts[b].dist - pts[a].dist;
        pts[i].speed = dt > 0 ? clamp((ds / dt) * 3.6, 0, 300) : 50;
      }
    }

    // Höhe
    let lastEle = pts.find((p) => p.ele !== null);
    lastEle = lastEle ? lastEle.ele : 0;
    for (const p of pts) {
      if (p.ele === null) p.ele = lastEle;
      else lastEle = p.ele;
    }

    // Steigung / Beschleunigung
    const eles = smooth(pts.map((p) => p.ele), 3, 1);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3);
      const ds = pts[b].dist - pts[a].dist;
      pts[i].grade = ds > 1 ? clamp(((eles[b] - eles[a]) / ds) * 100, -18, 18) : 0;
      const ta = Math.max(0, i - 1), tb = Math.min(n - 1, i + 1);
      const dt = pts[tb].time - pts[ta].time;
      pts[i].accel = dt > 0 ? clamp(((pts[tb].speed - pts[ta].speed) / 3.6) / dt, -4, 4) : 0;
      pts[i].ele = eles[i];
    }

    // Verbrauch: vorhandene Werte übernehmen, fehlende schätzen
    let estimatedCount = 0;
    let measuredCount = 0;
    for (let i = 0; i < n; i++) {
      if (pts[i].cons === null) {
        estimatedCount++;
        pts[i].cons = estimateConsumption(pts[i].speed, pts[i].grade, pts[i].accel, null);
        pts[i].consSrc = 'estimate';
      } else {
        measuredCount++;
        if (!pts[i].consSrc) pts[i].consSrc = 'file';
      }
    }

    for (let i = 0; i < n; i++) {
      pts[i].bearing = bearing(pts[i], pts[Math.min(n - 1, i + 3)] || pts[i]);
    }

    const stops = Array.isArray(meta.stops) && meta.stops.length ? meta.stops : detectStops(pts);
    const obdPoints = pts.filter((p) => p.consSrc === 'obd' || p.obd).length;
    const stats = buildStats(pts, meta);
    return {
      name: meta.name || 'Importierte Fahrt',
      meta: {
        source: meta.source || 'import',
        date: meta.date || (firstAbsTime !== null ? new Date(firstAbsTime * 1000).toISOString() : new Date().toISOString()),
        label: meta.label || 'Import',
        estimatedCons: meta.estimatedCons !== undefined
          ? meta.estimatedCons
          : (measuredCount === 0 || estimatedCount > measuredCount),
        fileName: meta.fileName || null,
        notes: String(meta.notes || '').slice(0, 400),
        obd: !!meta.obd || obdPoints > 0,
        consSource: meta.consSource || (obdPoints > 0 ? 'obd' : (measuredCount > 0 ? 'file' : 'estimate'))
      },
      points: pts,
      stats,
      stops
    };
  }

  window.TripSim = {
    buildSimulation,
    finalize,
    estimateConsumption,
    haversine,
    detectStops
  };
})();
