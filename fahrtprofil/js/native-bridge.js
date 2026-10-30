/* Fahrtprofil – Brücke zur Android-App
 *
 * Läuft die Web-App in der Android-Hülle, existiert window.AndroidBridge.
 * Dann ersetzt dieses Skript navigator.geolocation durch eine Version, die den
 * GPS-Dienst der App nutzt. Der Dienst läuft im Vordergrund-Modus weiter, auch
 * wenn der Bildschirm aus ist oder eine andere App offen ist. Die gesammelten
 * Punkte werden hier abgeholt und der Web-App wie normale Positionen übergeben.
 *
 * Im normalen Browser (kein AndroidBridge) passiert nichts.
 */
(function () {
  'use strict';

  const B = window.AndroidBridge;
  if (!B) return;
  window.__native = true;

  const POLL_MS = 1000;
  const watchers = new Map();
  let nextId = 1;
  let nextIndex = 0;
  let timer = 0;

  function toPosition(p) {
    return {
      coords: {
        latitude: p.lat,
        longitude: p.lng,
        altitude: p.alt,
        accuracy: p.acc,
        altitudeAccuracy: null,
        heading: p.hdg,
        speed: p.spd
      },
      timestamp: p.t
    };
  }

  function fail(code, message) {
    const err = {
      code,
      message: message || '',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3
    };
    watchers.forEach((w) => { if (w.error) w.error(err); });
  }

  function poll() {
    let res;
    try {
      res = JSON.parse(B.drainPoints(nextIndex));
    } catch (e) {
      return;
    }
    nextIndex = res.next;
    for (const p of res.points) {
      const pos = toPosition(p);
      watchers.forEach((w) => w.success(pos));
    }
    if (res.error) fail(res.error, res.message);
  }

  function startNative() {
    nextIndex = 0;
    B.startTracking();
    B.setKeepScreenOn(true);
    timer = setInterval(poll, POLL_MS);
  }

  function stopNative() {
    poll(); // letzte Punkte noch abholen
    clearInterval(timer);
    timer = 0;
    B.setKeepScreenOn(false);
    B.stopTracking();
  }

  const shim = {
    watchPosition(success, error) {
      const id = nextId++;
      const first = watchers.size === 0;
      watchers.set(id, { success, error });
      if (first) startNative();
      return id;
    },
    clearWatch(id) {
      if (!watchers.delete(id)) return;
      if (watchers.size === 0) stopNative();
    },
    getCurrentPosition(success, error) {
      const id = shim.watchPosition((pos) => {
        shim.clearWatch(id);
        success(pos);
      }, error);
    }
  };

  try {
    Object.defineProperty(navigator, 'geolocation', { value: shim, configurable: true });
  } catch (e) {
    /* Notfalls bleibt die Browser-Ortung aktiv */
  }

  // Nach dem Zurückkehren in die App sofort aufholen, was im Hintergrund gesammelt wurde
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && timer) poll();
  });

  // Version unter dem Titel anzeigen
  function showVersion() {
    try {
      const p = document.querySelector('.brand-text p');
      if (p) p.textContent += ' · v' + B.appVersion();
    } catch (e) { /* nicht kritisch */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showVersion);
  else showVersion();
})();
