/* Fahrtprofil – lokale Ablage für Fahrten
 * Speichert komplette Fahrten (Punkte + Kennzahlen) in IndexedDB.
 * Wenn IndexedDB nicht verfügbar ist, wird localStorage als Notlösung genutzt.
 * Alles bleibt auf dem Gerät, es gibt keine Synchronisation.
 */
(function () {
  'use strict';

  const DB_NAME = 'fahrtprofil';
  const DB_VERSION = 1;
  const FULL = 'trips';
  const META = 'summaries';
  const LS_INDEX = 'fahrtprofil.summaries';
  const LS_TRIP = 'fahrtprofil.trip.';

  let dbPromise = null;
  let fallback = false;

  function openDB() {
    if (fallback || typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        fallback = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FULL)) {
          db.createObjectStore(FULL, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { fallback = true; resolve(null); };
    });
    return dbPromise;
  }

  function newId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
      return 'trip_' + crypto.randomUUID();
    }
    return 'trip_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function round(v, digits) {
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  function encode(trip, id, savedAt) {
    return {
      v: 1,
      id,
      savedAt,
      name: trip.name || 'Fahrt',
      meta: {
        source: trip.meta.source || 'gps',
        date: trip.meta.date || savedAt,
        label: trip.meta.label || '',
        estimatedCons: !!trip.meta.estimatedCons,
        fileName: trip.meta.fileName || null
      },
      stats: {
        totalDist: trip.stats.totalDist,
        duration: trip.stats.duration,
        avgCons: trip.stats.avgCons,
        maxCons: trip.stats.maxCons,
        maxSpeed: trip.stats.maxSpeed,
        avgSpeed: trip.stats.avgSpeed,
        fuel: trip.stats.fuel
      },
      points: trip.points.map((p) => [
        round(p.lat, 6),
        round(p.lng, 6),
        round(p.ele, 1),
        round(p.speed, 1),
        round(p.cons, 2),
        round(p.dist, 1),
        round(p.time, 1),
        p.phase || null,
        round(p.bearing || 0, 0)
      ])
    };
  }

  function decode(rec) {
    return {
      id: rec.id,
      name: rec.name,
      meta: rec.meta,
      stats: rec.stats,
      stops: [],
      points: rec.points.map((a) => ({
        lat: a[0],
        lng: a[1],
        ele: a[2],
        speed: a[3],
        cons: a[4],
        dist: a[5],
        time: a[6],
        phase: a[7],
        bearing: a[8]
      }))
    };
  }

  function summarize(rec) {
    const s = rec.stats || {};
    return {
      id: rec.id,
      savedAt: rec.savedAt,
      name: rec.name,
      date: rec.meta.date,
      source: rec.meta.source,
      label: rec.meta.label,
      estimatedCons: !!rec.meta.estimatedCons,
      km: (s.totalDist || 0) / 1000,
      duration: s.duration || 0,
      avgCons: s.avgCons || 0,
      maxCons: s.maxCons || 0,
      avgSpeed: s.avgSpeed || 0,
      fuel: s.fuel || 0,
      points: rec.points.length
    };
  }

  function byNewest(a, b) {
    return String(b.savedAt).localeCompare(String(a.savedAt));
  }

  /* ---------- localStorage-Notlösung ---------- */

  function lsIndex() {
    try {
      const list = JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function lsSave(rec, summary) {
    localStorage.setItem(LS_TRIP + rec.id, JSON.stringify(rec));
    const list = lsIndex().filter((t) => t.id !== rec.id);
    list.push(summary);
    localStorage.setItem(LS_INDEX, JSON.stringify(list));
  }

  /* ---------- API ---------- */

  async function save(trip) {
    if (!trip || !trip.points || trip.points.length < 2) {
      throw new Error('Fahrt enthält keine Punkte.');
    }
    const id = trip.id || newId();
    const savedAt = new Date().toISOString();
    const rec = encode(trip, id, savedAt);
    const summary = summarize(rec);

    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persist().catch(() => {});
    }

    const db = await openDB();
    if (!db) {
      lsSave(rec, summary);
      trip.id = id;
      return summary;
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction([FULL, META], 'readwrite');
      tx.objectStore(FULL).put(rec);
      tx.objectStore(META).put(summary);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Speichern fehlgeschlagen.'));
      tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen.'));
    });

    trip.id = id;
    return summary;
  }

  async function list() {
    const db = await openDB();
    if (!db) return lsIndex().sort(byNewest);

    return new Promise((resolve) => {
      const tx = db.transaction(META, 'readonly');
      const req = tx.objectStore(META).getAll();
      req.onsuccess = () => resolve((req.result || []).sort(byNewest));
      req.onerror = () => resolve([]);
    });
  }

  async function get(id) {
    const db = await openDB();
    if (!db) {
      try {
        const raw = localStorage.getItem(LS_TRIP + id);
        return raw ? decode(JSON.parse(raw)) : null;
      } catch (err) {
        return null;
      }
    }

    return new Promise((resolve) => {
      const tx = db.transaction(FULL, 'readonly');
      const req = tx.objectStore(FULL).get(id);
      req.onsuccess = () => resolve(req.result ? decode(req.result) : null);
      req.onerror = () => resolve(null);
    });
  }

  async function remove(id) {
    const db = await openDB();
    if (!db) {
      localStorage.removeItem(LS_TRIP + id);
      localStorage.setItem(LS_INDEX, JSON.stringify(lsIndex().filter((t) => t.id !== id)));
      return;
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction([FULL, META], 'readwrite');
      tx.objectStore(FULL).delete(id);
      tx.objectStore(META).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Löschen fehlgeschlagen.'));
    });
  }

  window.TripStore = { save, list, get, remove };
})();
