/* Fahrtprofil – Oberfläche für OBD-II / CAN
 *
 * Baut auf js/obd.js auf und zeigt Livewerte, Fehlercodes, ein Rohprotokoll
 * und den HUD-Vollbildmodus. Ohne Adapter lässt sich alles im Demo-Modus
 * durchklicken – dieselbe Oberfläche, dieselben Befehle.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const VALUE_MAP = {
    speed: ['dgSpeed', 'dgSpeedBar', 240, nf0],
    rpm: ['dgRpm', 'dgRpmBar', 7000, nf0],
    coolant: ['dgCool', 'dgCoolBar', 130, nf0],
    load: ['dgLoad', 'dgLoadBar', 100, nf0],
    throttle: ['dgThr', 'dgThrBar', 100, nf0],
    maf: ['dgMaf', 'dgMafBar', 200, nf1],
    map: ['dgMap', 'dgMapBar', 255, nf0],
    volt: ['dgVolt', 'dgVoltBar', 20, nf1]
  };

  let src = 'demo';
  let logRunning = false;
  let hudOpen = false;
  let hudTimer = 0;
  let sparkObs = null;
  let ready = false;

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();

  function init() {
    if (ready) return;
    if (!$('diagPage')) return;
    ready = true;

    $('dgConnect').addEventListener('click', toggleConnect);
    $('dgHud').addEventListener('click', () => toggleHud());
    $('dgReadDtc').addEventListener('click', readDtc);
    $('dgClearDtc').addEventListener('click', clearDtc);
    $('dgScan').addEventListener('click', scanPids);
    $('dgSendForm').addEventListener('submit', sendManual);
    $('dgLogBtn').addEventListener('click', toggleLog);
    $('dgClearLog').addEventListener('click', () => { $('dgConsole').innerHTML = ''; });
    $('hud').addEventListener('click', () => toggleHud(false));
    document.addEventListener('keydown', onKey);

    document.querySelectorAll('.dg-src').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (FahrtOBD.isConnected()) return;
        src = btn.dataset.src;
        document.querySelectorAll('.dg-src').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    markAvailability();
    setSource('demo');

    FahrtOBD.on('status', (e) => {
      setStatus(e.state, e.text);
      const on = e.state === 'connected';
      document.querySelectorAll('.dg-src').forEach((b) => { b.disabled = on; });
      $('dgBaud').disabled = on;
      if (e.state === 'off' || e.state === 'error') {
        if (logRunning) stopLogUI(false);
        markAvailability();
      }
      updateConnectBtn();
    });

    FahrtOBD.on('value', (e) => {
      const m = VALUE_MAP[e.key];
      if (!m) return;
      const el = $(m[0]);
      if (el) el.textContent = m[3].format(e.value);
      const bar = $(m[1]);
      if (bar) bar.style.width = Math.max(2, Math.min(100, (e.value / m[2]) * 100)) + '%';
    });

    FahrtOBD.on('cons', () => {
      renderCons();
      drawSpark();
    });

    FahrtOBD.on('error', (e) => {
      if (e && e.message) consoleLine('! ' + e.message, 'err');
    });

    FahrtOBD.on('log', (e) => {
      const btn = $('dgLogBtn');
      if (e.active) {
        btn.textContent = 'Log stoppen · ' + e.rows;
        btn.classList.add('recording');
      } else {
        btn.textContent = 'Log starten';
        btn.classList.remove('recording');
      }
    });

    if (window.ResizeObserver && $('dgSpark')) {
      sparkObs = new ResizeObserver(() => drawSpark());
      sparkObs.observe($('dgSpark'));
    }

    setStatus('off', 'Nicht verbunden');
    renderCons();
    drawSpark();
  }

  /* ---------- Verbindung ---------- */

  function markAvailability() {
    const caps = {
      demo: true,
      bridge: !!(window.AndroidBridge && (window.AndroidBridge.obdConnect || window.AndroidBridge.obdSend)),
      serial: !!navigator.serial,
      ble: !!navigator.bluetooth
    };
    document.querySelectorAll('.dg-src').forEach((btn) => {
      const key = btn.dataset.src;
      const ok = !!caps[key];
      btn.disabled = !ok;
      btn.title = ok ? '' : key === 'bridge'
        ? 'Die installierte Android-App liefert noch keine OBD-Brücke.'
        : key === 'serial'
          ? 'Web Serial braucht Chrome/Edge über HTTPS oder localhost.'
          : 'Web Bluetooth braucht Chrome über HTTPS oder localhost.';
    });
    if (!caps[src]) setSource('demo');
  }

  function setSource(next) {
    src = next;
    document.querySelectorAll('.dg-src').forEach((b) => b.classList.toggle('active', b.dataset.src === next));
  }

  async function toggleConnect() {
    const btn = $('dgConnect');
    if (FahrtOBD.isConnected()) {
      await FahrtOBD.disconnect();
      setStatus('off', 'Nicht verbunden');
      return;
    }
    btn.disabled = true;
    setStatus('connecting', 'Verbinde …');
    try {
      const info = await FahrtOBD.connect(src, { baud: Number($('dgBaud').value) || 38400 });
      consoleLine('· Verbunden mit ' + (info.name || info.kind), 'ok');
      toast('Verbunden · ' + (info.name || info.kind));
    } catch (err) {
      setStatus('error', err.message || 'Verbindung fehlgeschlagen');
      consoleLine('! ' + (err.message || 'Verbindung fehlgeschlagen'), 'err');
      toast(err.message || 'Verbindung fehlgeschlagen', true);
    } finally {
      btn.disabled = false;
      updateConnectBtn();
    }
  }

  function updateConnectBtn() {
    const btn = $('dgConnect');
    if (!btn) return;
    const on = FahrtOBD.isConnected();
    btn.textContent = on ? 'Trennen' : 'Verbinden';
    btn.classList.toggle('primary', !on);
    btn.classList.toggle('danger', on);
  }

  function setStatus(state, text) {
    const el = $('dgStatus');
    if (!el) return;
    el.className = 'dg-status state-' + state;
    const label = el.querySelector('span');
    if (label) label.textContent = text || '';
    updateConnectBtn();
  }

  /* ---------- Livewerte ---------- */

  function renderCons() {
    const s = FahrtOBD.snapshot();
    const el = $('dgCons');
    const meta = $('dgConsMeta');
    if (!el) return;
    if (s.live && s.cons != null && s.speed >= 3) {
      el.textContent = nf1.format(s.cons);
      meta.textContent = s.consSrc ? 'berechnet aus ' + s.consSrc : 'Livewert';
    } else if (s.live) {
      el.textContent = '0,0';
      meta.textContent = s.speed != null ? 'Stand / Leerlauf' : 'Noch keine Werte';
    } else {
      el.textContent = '–';
      meta.textContent = 'Nicht verbunden';
    }
  }

  function drawSpark() {
    const c = $('dgSpark');
    if (!c) return;
    const rect = c.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 6) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (c.width !== Math.round(rect.width * dpr) || c.height !== Math.round(rect.height * dpr)) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const rows = FahrtOBD.history();
    if (rows.length < 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h - 4);
      ctx.lineTo(w, h - 4);
      ctx.stroke();
      return;
    }

    let max = 10;
    for (const r of rows) if (r.v > max) max = r.v;
    max = Math.max(12, Math.ceil((max * 1.15) / 4) * 4);
    const x = (i) => (i / (rows.length - 1)) * w;
    const y = (v) => h - 3 - (Math.min(max, v) / max) * (h - 8);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,209,102,0.28)');
    grad.addColorStop(1, 'rgba(255,209,102,0.01)');
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < rows.length; i++) ctx.lineTo(x(i), y(rows[i].v));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < rows.length; i++) {
      if (i === 0) ctx.moveTo(x(i), y(rows[i].v));
      else ctx.lineTo(x(i), y(rows[i].v));
    }
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const last = rows[rows.length - 1];
    ctx.beginPath();
    ctx.arc(x(rows.length - 1), y(last.v), 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
  }

  /* ---------- Fehlercodes ---------- */

  async function readDtc() {
    if (!FahrtOBD.isConnected()) return toast('Bitte zuerst verbinden.', true);
    const host = $('dgDtc');
    host.innerHTML = '<span class="dg-empty">Lese Fehlercodes …</span>';
    try {
      const res = await FahrtOBD.readDtc();
      renderDtc(res.codes, res.mil);
      consoleLine('· Fehlercodes: ' + (res.codes.length ? res.codes.join(', ') : 'keine'), 'ok');
    } catch (err) {
      host.innerHTML = '<span class="dg-empty">' + esc(err.message) + '</span>';
      toast(err.message, true);
    }
  }

  function renderDtc(codes, mil) {
    const host = $('dgDtc');
    $('dgMil').hidden = !mil;
    if (!codes.length) {
      host.innerHTML = '<span class="dg-empty">Keine gespeicherten Fehler' + (mil ? ' · MIL leuchtet' : '') + '</span>';
      return;
    }
    host.innerHTML = codes.map((c) => '<span class="dg-code">' + esc(c) + '</span>').join('');
  }

  async function clearDtc() {
    if (!FahrtOBD.isConnected()) return toast('Bitte zuerst verbinden.', true);
    if (!window.confirm('Gespeicherte Fehlercodes löschen? Die Lampe geht erst nach einer Prüfrunde aus.')) return;
    try {
      const ok = await FahrtOBD.clearDtc();
      if (ok) {
        renderDtc([], false);
        toast('Fehlercodes gelöscht');
        consoleLine('· Fehlercodes gelöscht', 'ok');
      } else {
        toast('Löschen wurde abgelehnt', true);
      }
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function scanPids() {
    if (!FahrtOBD.isConnected()) return toast('Bitte zuerst verbinden.', true);
    try {
      const list = await FahrtOBD.scanSupported();
      consoleLine('· Unterstützte PIDs (' + list.length + '): ' + list.join(' '), 'ok');
      toast(list.length + ' unterstützte PIDs gefunden');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------- Konsole / Log ---------- */

  function consoleLine(text, cls) {
    const box = $('dgConsole');
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const row = document.createElement('div');
    row.className = 'dg-line' + (cls ? ' ' + cls : '');
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    row.innerHTML = '<span class="dg-time">' + time + '</span><span class="dg-text">' + esc(text) + '</span>';
    box.appendChild(row);
    while (box.children.length > 300) box.removeChild(box.firstChild);
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  async function sendManual(e) {
    e.preventDefault();
    const input = $('dgCmd');
    const cmd = input.value.trim();
    if (!cmd) return;
    if (!FahrtOBD.isConnected()) return toast('Bitte zuerst verbinden.', true);
    input.value = '';
    consoleLine('> ' + cmd.toUpperCase(), 'out');
    try {
      const raw = await FahrtOBD.command(cmd.toUpperCase(), 4000);
      consoleLine('< ' + (raw || '(leer)'), 'in');
    } catch (err) {
      consoleLine('! ' + err.message, 'err');
    }
  }

  function toggleLog() {
    if (logRunning) { stopLogUI(true); return; }
    if (!FahrtOBD.isConnected()) return toast('Bitte zuerst verbinden.', true);
    FahrtOBD.startLog();
    logRunning = true;
    toast('Log läuft – Werte werden mitgeschrieben');
  }

  function stopLogUI(download) {
    logRunning = false;
    const rows = FahrtOBD.stopLog();
    $('dgLogBtn').textContent = 'Log starten';
    $('dgLogBtn').classList.remove('recording');
    if (!download) return;
    if (!rows.length) {
      toast('Keine Werte im Log', true);
      return;
    }
    const head = 'zeit;ms;pid;name;wert;einheit;antwort';
    const body = rows.map((r) =>
      [new Date(r.t).toISOString(), r.ms, r.key, r.name, String(r.value).replace('.', ','), r.unit, (r.raw || '').replace(/[\r\n;]+/g, ' ')]
        .join(';')
    ).join('\n');
    const name = 'obd-log-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv';
    downloadFile(name, 'text/csv', head + '\n' + body);
    toast(rows.length + ' Werte als CSV gespeichert');
  }

  function downloadFile(name, mime, text) {
    if (window.AndroidBridge && typeof AndroidBridge.shareFile === 'function') {
      AndroidBridge.shareFile(name, mime, text);
      return;
    }
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- HUD ---------- */

  function onKey(e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Escape' && hudOpen) {
      e.preventDefault();
      toggleHud(false);
      return;
    }
    if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleHud();
    }
  }

  function toggleHud(force) {
    const next = typeof force === 'boolean' ? force : !hudOpen;
    hudOpen = next;
    const hud = $('hud');
    if (!hud) return;
    hud.hidden = !next;
    document.body.classList.toggle('hud-open', next);
    clearInterval(hudTimer);
    if (next) {
      updateHud();
      hudTimer = setInterval(updateHud, 220);
    }
  }

  function updateHud() {
    const obd = FahrtOBD.snapshot();
    const gps = window.FahrtApp && FahrtApp.gpsLive ? FahrtApp.gpsLive() : null;
    const speed = obd.live && obd.speed != null ? obd.speed : gps && gps.speed != null ? gps.speed : null;
    const cons = obd.live ? obd.cons : null;

    $('hudSpeed').textContent = speed != null ? nf0.format(speed) : '–';
    $('hudCons').textContent = cons != null && speed >= 3 ? nf1.format(cons) : '–';
    $('hudRpm').textContent = obd.live && obd.rpm != null ? nf0.format(obd.rpm) : '–';
    $('hudCool').textContent = obd.live && obd.coolant != null ? nf0.format(obd.coolant) : '–';

    const dot = $('hudDot');
    const state = obd.live ? 'OBD' : gps && gps.active ? 'GPS' : 'off';
    dot.className = 'hud-dot ' + state;
    $('hudState').textContent = state === 'off' ? 'Kein Signal' : state;
    $('hudTime').textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Seite ---------- */

  function open() {
    const page = $('diagPage');
    if (!page) return;
    page.hidden = false;
    void page.offsetWidth;
    page.classList.add('open');
    document.body.classList.add('page-open');
    const app = document.querySelector('.app');
    if (app) app.inert = true;
    drawSpark();
  }

  function close() {
    const page = $('diagPage');
    if (!page || page.hidden) return;
    page.classList.remove('open');
    document.body.classList.remove('page-open');
    const app = document.querySelector('.app');
    if (app) app.inert = false;
    setTimeout(() => { if (!page.classList.contains('open')) page.hidden = true; }, 240);
  }

  function toast(msg, isError) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.remove('show'), 3200);
  }

  window.FahrtDiag = { open, close, hud: toggleHud, readDtc, scanPids };
})();
