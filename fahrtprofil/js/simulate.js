/* Fahrtprofil – Routen- und Verbrauchssimulation
 * Erzeugt eine plausible Fahrt (GPS-Punkte, Höhenprofil, Tempo, Verbrauch).
 * Später können echte Daten über data.js importiert werden.
 */
(function () {
  'use strict';

  // lat, lng, Höhe (m), Zieltempo (km/h), Abschnitt
  const WAYPOINTS = [
    [48.1374, 11.5755, 519, 0,   'Stadt'],       // Marienplatz
    [48.1335, 11.5748, 519, 28,  'Stadt'],
    [48.1288, 11.5715, 520, 38,  'Stadt'],
    [48.1230, 11.5655, 521, 45,  'Stadt'],
    [48.1168, 11.5580, 522, 42,  'Stadt'],
    [48.1105, 11.5480, 523, 48,  'Stadt'],
    [48.1040, 11.5380, 524, 52,  'Stadt'],
    [48.0972, 11.5270, 525, 58,  'Stadt'],
    [48.0895, 11.5145, 528, 68,  'Landstraße'],
    [48.0805, 11.4960, 535, 80,  'Landstraße'],
    [48.0705, 11.4760, 548, 92,  'Landstraße'],
    [48.0600, 11.4560, 562, 105, 'Autobahn'],
    [48.0480, 11.4350, 578, 118, 'Autobahn'],
    [48.0340, 11.4150, 592, 124, 'Autobahn'],
    [48.0200, 11.3950, 600, 126, 'Autobahn'],
    [48.0060, 11.3760, 598, 122, 'Autobahn'],
    [47.9960, 11.3620, 592, 108, 'Autobahn'],
    [47.9905, 11.3500, 588, 78,  'Landstraße'],  // Ausfahrt Starnberg
    [47.9892, 11.3370, 586, 58,  'Stadt'],
    [47.9860, 11.3230, 588, 62,  'Landstraße'],
    [47.9790, 11.3070, 598, 70,  'Landstraße'],
    [47.9700, 11.2950, 600, 70,  'Landstraße'],
    [47.9620, 11.2890, 612, 65,  'Landstraße'],
    [47.9540, 11.2830, 632, 60,  'Landstraße'],
    [47.9460, 11.2770, 700, 55,  'Landstraße'],  // steiler Anstieg
    [47.9380, 11.2710, 745, 52,  'Landstraße'],
    [47.9420, 11.2530, 752, 58,  'Landstraße'],
    [47.9500, 11.2350, 758, 62,  'Landstraße'],
    [47.9600, 11.2180, 748, 56,  'Landstraße'],
    [47.9700, 11.1990, 732, 52,  'Landstraße'],
    [47.9810, 11.1850, 696, 48,  'Landstraße'],
    [47.9910, 11.1790, 628, 50,  'Stadt'],       // Herrsching
    [48.0005, 11.1765, 570, 52,  'Stadt'],
    [48.0090, 11.1880, 565, 60,  'Landstraße'],
    [48.0180, 11.2030, 578, 70,  'Landstraße'],
    [48.0270, 11.2210, 596, 78,  'Landstraße'],
    [48.0360, 11.2400, 610, 84,  'Landstraße'],
    [48.0450, 11.2620, 616, 88,  'Landstraße'],
    [48.0535, 11.2880, 610, 92,  'Landstraße'],
    [48.0615, 11.3150, 600, 90,  'Landstraße'],
    [48.0690, 11.3400, 592, 96,  'Landstraße'],  // Gauting
    [48.0760, 11.3660, 586, 100, 'Landstraße'],
    [48.0830, 11.3930, 578, 112, 'Autobahn'],
    [48.0890, 11.4210, 570, 120, 'Autobahn'],
    [48.0945, 11.4500, 560, 122, 'Autobahn'],
    [48.1000, 11.4800, 550, 115, 'Autobahn'],
    [48.1055, 11.5100, 543, 92,  'Landstraße'],
    [48.1110, 11.5350, 536, 72,  'Stadt'],
    [48.1170, 11.5500, 530, 60,  'Stadt'],
    [48.1235, 11.5620, 525, 52,  'Stadt'],
    [48.1295, 11.5705, 521, 42,  'Stadt'],
    [48.1374, 11.5755, 519, 0,   'Stadt']
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
    let maxCons = 0, maxSpeed = 0, sumCons = 0;
    for (const p of points) {
      if (p.cons > maxCons) maxCons = p.cons;
      if (p.speed > maxSpeed) maxSpeed = p.speed;
      sumCons += p.cons;
    }
    const avgCons = (fuel / (totalDist / 1000)) * 100;
    return {
      totalDist,
      duration: points[points.length - 1].time,
      avgCons: isFinite(avgCons) ? avgCons : 0,
      maxCons,
      maxSpeed,
      avgSpeed: totalDist / 1000 / (points[points.length - 1].time / 3600),
      fuel
    };
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
      pts[i].bearing = bearing(pts[i], pts[Math.min(n - 1, i + 3)] || pts[i]);
    }

    const stats = buildStats(pts, {});
    const date = new Date();
    const trip = {
      name: 'München – Starnberg – Herrsching',
      meta: {
        source: 'simulation',
        date: date.toISOString(),
        seed,
        label: 'Simulation',
        estimatedCons: true
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

    const pts = raw.map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      ele: Number.isFinite(Number(p.ele)) ? Number(p.ele) : null,
      speed: Number.isFinite(Number(p.speed)) ? Number(p.speed) : null,
      cons: Number.isFinite(Number(p.cons)) ? Number(p.cons) : null,
      time: Number.isFinite(Number(p.time)) ? Number(p.time) : null,
      dist: Number.isFinite(Number(p.dist)) ? Number(p.dist) : null,
      phase: p.phase || null
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
    let estimated = false;
    for (let i = 0; i < n; i++) {
      if (pts[i].cons === null) {
        estimated = true;
        pts[i].cons = estimateConsumption(pts[i].speed, pts[i].grade, pts[i].accel, null);
      }
    }

    for (let i = 0; i < n; i++) {
      pts[i].bearing = bearing(pts[i], pts[Math.min(n - 1, i + 3)] || pts[i]);
    }

    const stats = buildStats(pts, meta);
    return {
      name: meta.name || 'Importierte Fahrt',
      meta: {
        source: meta.source || 'import',
        date: meta.date || (firstAbsTime !== null ? new Date(firstAbsTime * 1000).toISOString() : new Date().toISOString()),
        label: meta.label || 'Import',
        estimatedCons: meta.estimatedCons !== undefined ? meta.estimatedCons : estimated,
        fileName: meta.fileName || null
      },
      points: pts,
      stats,
      stops: []
    };
  }

  window.TripSim = {
    buildSimulation,
    finalize,
    estimateConsumption,
    haversine
  };
})();
