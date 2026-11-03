/* Fahrtprofil – OBD-II / CAN
 *
 * Eine kleine, eigenständige ELM327-Schicht. Sie kennt vier Wege zum Adapter:
 *
 *   demo    – simuliert eine Fahrt, damit die Oberfläche ohne Hardware testbar ist
 *   bridge  – window.AndroidBridge (native USB-/Bluetooth-Anbindung der APK)
 *   serial  – Web Serial API (USB-ELM327 am Laptop/Android-Chrome)
 *   ble     – Web Bluetooth (BLE-ELM327, z. B. Vgate iCar Pro)
 *
 * Alle Wege sprechen dieselbe Text-Konvention: Befehl + \r, Antwort bis '>'.
 * Die Schicht liest die üblichen Mode-01-PIDs, berechnet den Momentanverbrauch
 * aus MAF bzw. Kraftstoffrate und stellt Ereignisse für die Oberfläche bereit.
 *
 * Es werden keine Daten übertragen – alles bleibt im Gerät.
 */
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const HEX = (n, bytes) => {
    const v = Math.max(0, Math.round(Number(n) || 0));
    return v.toString(16).toUpperCase().padStart((bytes || 1) * 2, '0');
  };

  /* ---------- PID-Tabelle ----------
   * bytes = erwartete Nutzbytes, parse bekommt ein Array dieser Bytes.
   */
  const PIDS = {
    speed:    { cmd: '010D', name: 'Tempo',         unit: 'km/h',  bytes: 1, max: 240, parse: (d) => d[0] },
    rpm:      { cmd: '010C', name: 'Drehzahl',      unit: '1/min', bytes: 2, max: 7000, parse: (d) => ((d[0] << 8) + d[1]) / 4 },
    coolant:  { cmd: '0105', name: 'Kühlmittel',    unit: '°C',    bytes: 1, max: 130, parse: (d) => d[0] - 40 },
    intake:   { cmd: '010F', name: 'Ansaugluft',    unit: '°C',    bytes: 1, max: 80,  parse: (d) => d[0] - 40 },
    load:     { cmd: '0104', name: 'Motorlast',     unit: '%',     bytes: 1, max: 100, parse: (d) => (d[0] * 100) / 255 },
    throttle: { cmd: '0111', name: 'Drosselklappe', unit: '%',     bytes: 1, max: 100, parse: (d) => (d[0] * 100) / 255 },
    maf:      { cmd: '0110', name: 'Luftmasse',     unit: 'g/s',   bytes: 2, max: 200, parse: (d) => ((d[0] << 8) + d[1]) / 100 },
    map:      { cmd: '010B', name: 'Saugrohrdruck', unit: 'kPa',   bytes: 1, max: 255, parse: (d) => d[0] },
    fuel:     { cmd: '012F', name: 'Tankinhalt',    unit: '%',     bytes: 1, max: 100, parse: (d) => (d[0] * 100) / 255 },
    volt:     { cmd: '0142', name: 'Bordspannung',  unit: 'V',     bytes: 2, max: 20,  parse: (d) => ((d[0] << 8) + d[1]) / 1000 },
    timing:   { cmd: '010E', name: 'Zündwinkel',    unit: '°',     bytes: 1, max: 60,  parse: (d) => d[0] / 2 - 64 },
    baro:     { cmd: '0133', name: 'Luftdruck',     unit: 'kPa',   bytes: 1, max: 120, parse: (d) => d[0] },
    fuelRate: { cmd: '015E', name: 'Kraftstoffrate', unit: 'L/h',  bytes: 2, max: 60,  parse: (d) => ((d[0] << 8) + d[1]) / 20 }
  };

  const POLL_FAST = ['speed', 'rpm'];
  const POLL_SLOW = ['coolant', 'load', 'throttle', 'maf', 'map', 'intake', 'volt', 'fuel', 'fuelRate'];

  /* ---------- Ereignisse ---------- */

  const listeners = Object.create(null);
  function on(name, fn) {
    (listeners[name] || (listeners[name] = [])).push(fn);
    return () => off(name, fn);
  }
  function off(name, fn) {
    const list = listeners[name];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  function emit(name, payload) {
    const list = listeners[name];
    if (!list) return;
    for (const fn of list.slice()) {
      try { fn(payload); } catch (e) { /* eine Oberfläche darf die Abfrage nicht stoppen */ }
    }
  }

  /* ---------- Zustand ---------- */

  const live = {
    speed: null, rpm: null, coolant: null, intake: null, load: null,
    throttle: null, maf: null, map: null, fuel: null, volt: null,
    timing: null, baro: null, fuelRate: null,
    cons: null, consSrc: null, at: 0
  };
  const history = [];          // {t, v} für die Verbrauchskurve
  let transport = null;
  let elmName = '';
  let connected = false;
  let kind = null;
  let polling = false;
  let pollTimer = 0;
  let slowIdx = 0;
  let queue = Promise.resolve();
  let logActive = false;
  let logRows = [];
  let logStart = 0;

  /* ---------- ELM327-Client ---------- */

  function makeElm(tp) {
    let buf = '';
    tp.onData((chunk) => { buf += chunk; });

    function clear() { buf = ''; }

    async function waitPrompt(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const i = buf.indexOf('>');
        if (i >= 0) {
          const out = buf.slice(0, i);
          buf = buf.slice(i + 1);
          return out.replace(/\r/g, '').trim();
        }
        await sleep(18);
      }
      const out = buf;
      buf = '';
      if (!out.trim()) throw new Error('Zeitüberschreitung – keine Antwort vom Adapter.');
      return out.replace(/\r/g, '').trim();
    }

    async function command(cmd, ms) {
      clear();
      await tp.write(cmd + '\r');
      const raw = await waitPrompt(ms || 1800);
      emit('raw', { cmd, raw, t: Date.now() });
      return raw;
    }

    /* Befehle nacheinander, damit sich Antworten nicht vermischen. */
    function run(cmd, ms) {
      const p = queue.then(() => command(cmd, ms), () => command(cmd, ms));
      queue = p.catch(() => {});
      return p;
    }

    return { command: run, rawCommand: command };
  }

  let elm = null;

  function hexPayload(raw, header) {
    if (!raw) return null;
    const clean = String(raw).toUpperCase().replace(/[^0-9A-F]/g, '');
    const i = clean.indexOf(header);
    if (i < 0) return null;
    return clean.slice(i + header.length);
  }

  function bytesFrom(hex, count) {
    if (!hex || hex.length < count * 2) return null;
    const out = [];
    for (let i = 0; i < count; i++) out.push(parseInt(hex.substr(i * 2, 2), 16));
    return out.every((n) => Number.isFinite(n)) ? out : null;
  }

  function isNoData(raw) {
    return /NO DATA|UNABLE TO CONNECT|CAN ERROR|BUS ERROR|STOPPED|ERROR|SEARCHING/i.test(raw || '');
  }

  async function readPid(key) {
    const def = PIDS[key];
    if (!def || !connected) return null;
    let raw;
    try {
      raw = await elm.command(def.cmd);
    } catch (e) {
      emit('error', { key, message: e.message });
      return null;
    }
    if (isNoData(raw)) return null;
    // Mode 01 → Antwortkopf 41 + PID (z. B. "410C")
    const header = '41' + def.cmd.slice(2);
    const data = bytesFrom(hexPayload(raw, header), def.bytes);
    if (!data) return null;
    const value = def.parse(data);
    if (!Number.isFinite(value)) return null;
    live[key] = value;
    live.at = Date.now();
    emit('value', { key, value, unit: def.unit, name: def.name, raw });
    return value;
  }

  function computeCons() {
    const v = live;
    if (v.speed == null || v.speed < 3) {
      v.cons = 0;
      v.consSrc = null;
    } else if (v.fuelRate != null && v.fuelRate > 0.1) {
      v.cons = clamp((v.fuelRate / v.speed) * 100, 0, 40);
      v.consSrc = 'Kraftstoffrate';
    } else if (v.maf != null && v.maf > 0.5) {
      // MAF g/s → Kraftstoff g/s (Lambda 1, Benzin 14,7) → L/h (0,745 kg/L)
      const lh = ((v.maf / 14.7) * 3600) / 745;
      v.cons = clamp((lh / v.speed) * 100, 0, 40);
      v.consSrc = 'MAF';
    } else if (v.load != null) {
      v.cons = clamp(2.2 + v.load * 0.16, 1, 40);
      v.consSrc = 'Motorlast';
    } else {
      v.cons = null;
      v.consSrc = null;
    }

    if (v.cons != null && v.speed >= 3) {
      const last = history[history.length - 1];
      if (!last || Date.now() - last.t > 700) {
        history.push({ t: Date.now(), v: v.cons });
        if (history.length > 240) history.shift();
        emit('cons', { value: v.cons, src: v.consSrc });
      }
    } else if (v.speed != null) {
      emit('cons', { value: 0, src: null, stationary: true });
    }
  }

  /* ---------- Transporte ---------- */

  /* Die Demo braucht keinen echten Datenkanal: Sie schiebt ihre Antworten
   * direkt in denselben Puffer, den sonst USB/Bluetooth füllen. */

  function createDemo() {
    let push = null;
    const s = {
      speed: 0, rpm: 780, coolant: 18, load: 10, throttle: 6,
      maf: 2.2, map: 32, fuel: 64, volt: 14.2, dtc: true
    };
    let timer = 0;
    let last = Date.now();
    let started = Date.now();

    function step() {
      const now = Date.now();
      const dt = Math.min(0.6, (now - last) / 1000);
      last = now;
      const t = ((now - started) / 1000) % 150;
      let target;
      if (t < 12) target = 0;
      else if (t < 38) target = ((t - 12) / 26) * 58;
      else if (t < 66) target = 58;
      else if (t < 78) target = 58 * (1 - (t - 66) / 12);
      else if (t < 112) target = ((t - 78) / 34) * 108;
      else if (t < 134) target = 108 - ((t - 112) / 22) * 108;
      else target = 0;

      const prev = s.speed;
      s.speed = clamp(s.speed + clamp(target - s.speed, -14 * dt, 9 * dt), 0, 180);
      const acc = (s.speed - prev) / Math.max(0.001, dt);
      s.rpm = clamp(760 + s.speed * 27 + Math.max(0, acc) * 260 + Math.sin(now / 480) * 30, 720, 5600);
      s.coolant = clamp(18 + Math.min(72, (now - started) / 9000), 18, 92);
      s.load = clamp(9 + Math.max(0, acc) * 16 + s.speed * 0.38, 5, 96);
      s.throttle = clamp(5 + Math.max(0, acc) * 12 + s.speed * 0.2, 3, 92);
      s.maf = clamp(1.9 + s.load * 0.22 + s.rpm * 0.0038, 1.5, 160);
      s.map = clamp(30 + s.load * 0.74, 28, 180);
      s.fuel = clamp(64 - ((now - started) / 900000) * 3, 0, 100);
      s.volt = clamp(14.25 - s.load * 0.0022, 12.8, 14.6);
    }

    function response(cmd) {
      if (/^ATZ|^ATI/.test(cmd)) return 'ELM327 v1.5 (Demo)';
      if (/^ATRV/.test(cmd)) return s.volt.toFixed(1) + 'V';
      if (/^ATDPN|^ATDP/.test(cmd)) return 'A6';
      if (/^AT/.test(cmd)) return 'OK';
      if (cmd === '0100') return '41 00 BE 3F A8 13';
      if (cmd === '0120') return '41 20 80 07 A0 01';
      if (cmd === '0140') return '41 40 FE D0 00 01';
      if (cmd === '0101') return s.dtc ? '41 01 81 07 65 04' : '41 01 00 07 65 04';
      if (cmd === '03') return s.dtc ? '43 01 33 00 00 00 00' : '43 00 00 00 00 00 00';
      if (cmd === '04') { s.dtc = false; return '44'; }
      if (cmd === '010C') return '41 0C ' + HEX(s.rpm * 4, 2);
      if (cmd === '010D') return '41 0D ' + HEX(s.speed, 1);
      if (cmd === '0105') return '41 05 ' + HEX(s.coolant + 40, 1);
      if (cmd === '010F') return '41 0F ' + HEX(28 + 40, 1);
      if (cmd === '0104') return '41 04 ' + HEX((s.load / 100) * 255, 1);
      if (cmd === '0111') return '41 11 ' + HEX((s.throttle / 100) * 255, 1);
      if (cmd === '0110') return '41 10 ' + HEX(s.maf * 100, 2);
      if (cmd === '010B') return '41 0B ' + HEX(s.map, 1);
      if (cmd === '012F') return '41 2F ' + HEX((s.fuel / 100) * 255, 1);
      if (cmd === '0142') return '41 42 ' + HEX(s.volt * 1000, 2);
      if (cmd === '010E') return '41 0E ' + HEX(8, 1);
      if (cmd === '0133') return '41 33 ' + HEX(101, 1);
      if (cmd === '015E') return '41 5E ' + HEX((s.maf / 14.7 * 3600 / 745) * 20, 2);
      return 'NO DATA';
    }

    return {
      name: 'Demo-Fahrt',
      onData(fn) { push = fn; },
      open: async () => { started = Date.now(); last = Date.now(); step(); timer = setInterval(step, 250); },
      write: async (text) => {
        const cmd = String(text).trim().toUpperCase().replace(/\s+/g, '');
        await sleep(30 + Math.random() * 40);
        if (push) push(response(cmd) + '\r\r>');
      },
      close: async () => { clearInterval(timer); }
    };
  }

  async function createSerial(baud) {
    if (!navigator.serial) throw new Error('Web Serial ist in diesem Browser nicht verfügbar (Chrome/Edge, HTTPS).');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: baud || 38400, dataBits: 8, stopBits: 1, parity: 'none' });
    const writer = port.writable.getWriter();
    const decoder = new TextDecoder();
    let closed = false;
    let onData = null;
    let reader = null;

    (async () => {
      try {
        reader = port.readable.getReader();
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && onData) onData(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        if (!closed) emit('error', { message: 'Lesefehler: ' + e.message });
      }
    })();

    return {
      name: 'USB · ' + (port.getInfo && port.getInfo().usbVendorId ? 'ELM327' : 'Serial'),
      onData(fn) { onData = fn; },
      open: async () => {},
      write: async (text) => writer.write(new TextEncoder().encode(text)),
      close: async () => {
        closed = true;
        try { if (reader) await reader.cancel(); } catch (e) { /* schon zu */ }
        try { writer.releaseLock(); } catch (e) { /* schon zu */ }
        try { await port.close(); } catch (e) { /* schon zu */ }
      }
    };
  }

  const BLE_SERVICES = [
    '0000fff0-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
  ];

  async function createBle() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth ist hier nicht verfügbar (Chrome, HTTPS).');
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_SERVICES
    });
    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    let writeChar = null;
    let notifyChar = null;

    for (const svc of services) {
      let chars = [];
      try { chars = await svc.getCharacteristics(); } catch (e) { continue; }
      for (const ch of chars) {
        if (!notifyChar && (ch.properties.notify || ch.properties.indicate)) notifyChar = ch;
        if (!writeChar && (ch.properties.write || ch.properties.writeWithoutResponse)) writeChar = ch;
      }
      if (writeChar && notifyChar) break;
    }
    if (!writeChar || !notifyChar) throw new Error('Gerät bietet keinen passenden Schreib-/Lesekanal.');

    let onData = null;
    const decoder = new TextDecoder();
    notifyChar.addEventListener('characteristicvaluechanged', (e) => {
      const v = e.target.value;
      if (v && onData) onData(decoder.decode(new Uint8Array(v.buffer)));
    });
    await notifyChar.startNotifications();

    return {
      name: 'Bluetooth · ' + (device.name || 'ELM327'),
      onData(fn) { onData = fn; },
      open: async () => {},
      write: async (text) => {
        const bytes = new TextEncoder().encode(text);
        for (let i = 0; i < bytes.length; i += 20) {
          await writeChar.writeValue(bytes.slice(i, i + 20));
        }
      },
      close: async () => {
        try { await notifyChar.stopNotifications(); } catch (e) { /* egal */ }
        try { device.gatt.disconnect(); } catch (e) { /* egal */ }
      }
    };
  }

  async function createBridge() {
    const B = window.AndroidBridge;
    if (!B || (typeof B.obdSend !== 'function' && typeof B.obdConnect !== 'function')) {
      throw new Error('Die Android-App stellt noch keine OBD-Brücke bereit.');
    }
    let list = [];
    try {
      const raw = typeof B.obdDevices === 'function' ? B.obdDevices() : '[]';
      list = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    } catch (e) { list = []; }
    const device = Array.isArray(list) && list.length ? list[0] : null;
    let info = null;
    try {
      const raw = typeof B.obdConnect === 'function' ? B.obdConnect(device ? (device.id || device.address) : '') : null;
      info = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch (e) {
      throw new Error('Verbindung über die App fehlgeschlagen: ' + e.message);
    }
    if (info && info.ok === false) throw new Error(info.error || 'Adapter antwortet nicht.');

    let onData = null;
    return {
      name: 'Android · ' + ((info && (info.name || info.device)) || (device && device.name) || 'OBD'),
      onData(fn) { onData = fn; },
      open: async () => {},
      write: async (text) => {
        if (typeof B.obdSend !== 'function') throw new Error('obdSend fehlt in der Android-Brücke.');
        const raw = B.obdSend(String(text).replace(/\r/g, ''));
        if (raw && onData) {
          let data = raw;
          try {
            const obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') data = obj.data != null ? obj.data : (obj.raw || '');
          } catch (e) { /* reiner Text */ }
          onData(String(data) + '\r\r>');
        }
      },
      close: async () => {
        try { if (typeof B.obdDisconnect === 'function') B.obdDisconnect(); } catch (e) { /* egal */ }
      }
    };
  }

  /* ---------- Verbindung ---------- */

  async function initElm() {
    const at = async (cmd, ms) => {
      try { return await elm.command(cmd, ms); } catch (e) { return ''; }
    };
    await at('ATZ', 3200);
    await at('ATE0', 1200);
    await at('ATL0', 1200);
    await at('ATS1', 1200);
    await at('ATH0', 1200);
    await at('ATSP0', 1600);
    const id = await at('ATI', 1500);
    if (/ELM|OBD|STN/i.test(id)) elmName = id.split(/\r|\n/).filter(Boolean)[0].trim();
  }

  async function connect(which, opts) {
    await disconnect();
    kind = which || 'demo';
    emit('status', { state: 'connecting', text: 'Verbinde …' });

    try {
      if (kind === 'demo') transport = createDemo();
      else if (kind === 'serial') transport = await createSerial(opts && opts.baud);
      else if (kind === 'ble') transport = await createBle();
      else if (kind === 'bridge') transport = await createBridge();
      else throw new Error('Unbekannte Verbindung: ' + kind);

      await transport.open();
      elm = makeElm(transport);
      await initElm();

      connected = true;
      live.at = Date.now();
      emit('status', { state: 'connected', text: elmName || transport.name || 'Verbunden' });
      startPolling();
      return { name: elmName || transport.name, kind };
    } catch (err) {
      await disconnect();
      emit('status', { state: 'error', text: err.message || 'Verbindung fehlgeschlagen' });
      throw err;
    }
  }

  async function disconnect() {
    stopPolling();
    stopLog();
    const tp = transport;
    transport = null;
    elm = null;
    connected = false;
    kind = null;
    elmName = '';
    for (const k of Object.keys(live)) live[k] = null;
    live.at = 0;
    history.length = 0;
    if (tp) {
      try { await tp.close(); } catch (e) { /* egal */ }
    }
    emit('status', { state: 'off', text: 'Nicht verbunden' });
  }

  /* ---------- Abfragezyklus ---------- */

  function startPolling(interval) {
    stopPolling();
    if (!connected) return;
    polling = true;
    const gap = Math.max(200, interval || 550);
    (async () => {
      while (polling && connected) {
        const t0 = Date.now();
        try {
          for (const key of POLL_FAST) await readPid(key);
          const slow = POLL_SLOW[slowIdx % POLL_SLOW.length];
          slowIdx++;
          await readPid(slow);
          computeCons();
        } catch (e) {
          if (connected) emit('error', { message: e.message });
        }
        const wait = gap - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
      }
    })();
  }

  function stopPolling() {
    polling = false;
    clearTimeout(pollTimer);
    pollTimer = 0;
  }

  /* ---------- Fehlercodes ---------- */

  function dtcCode(b1, b2) {
    const type = ['P', 'C', 'B', 'U'][(b1 & 0xC0) >> 6];
    const d1 = (b1 & 0x30) >> 4;
    const d2 = (b1 & 0x0F).toString(16).toUpperCase();
    const d3 = (b2 & 0xF0) >> 4;
    const d4 = (b2 & 0x0F).toString(16).toUpperCase();
    return type + d1 + d2 + d3 + d4;
  }

  async function readDtc() {
    if (!connected) throw new Error('Nicht verbunden.');
    const raw = await elm.command('03', 2500);
    const codes = [];
    if (!isNoData(raw)) {
      // Mehrzeilige Antworten wiederholen den Kopf 43 je Zeile; erst die
      // Kopfbytes entfernen, dann in 2-Byte-Paare zerlegen.
      const hex = String(raw)
        .toUpperCase()
        .split(/[\r\n]+/)
        .map((line) => line.replace(/[^0-9A-F]/g, ''))
        .filter(Boolean)
        .map((line) => (line.startsWith('43') ? line.slice(2) : line))
        .join('');
      for (let i = 0; i + 4 <= hex.length; i += 4) {
        const a = parseInt(hex.substr(i, 2), 16);
        const b = parseInt(hex.substr(i + 2, 2), 16);
        if (!a && !b) continue;
        const code = dtcCode(a, b);
        if (codes.indexOf(code) < 0) codes.push(code);
      }
    }

    let mil = false;
    try {
      const st = await elm.command('0101', 1500);
      const data = bytesFrom(hexPayload(st, '4101'), 4);
      if (data) mil = !!(data[0] & 0x80);
    } catch (e) { /* MIL ist optional */ }

    emit('dtc', { codes, mil });
    return { codes, mil };
  }

  async function clearDtc() {
    if (!connected) throw new Error('Nicht verbunden.');
    const raw = await elm.command('04', 3000);
    const ok = !isNoData(raw);
    emit('dtc', { codes: [], mil: false, cleared: ok });
    return ok;
  }

  async function scanSupported() {
    if (!connected) throw new Error('Nicht verbunden.');
    const found = [];
    for (const base of [0x00, 0x20, 0x40, 0x60]) {
      const cmd = '01' + base.toString(16).toUpperCase().padStart(2, '0');
      let raw;
      try { raw = await elm.command(cmd, 2200); } catch (e) { continue; }
      if (isNoData(raw)) continue;
      const data = bytesFrom(hexPayload(raw, '41' + cmd.slice(2)), 4);
      if (!data) continue;
      const bits = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
      for (let i = 0; i < 32; i++) {
        if (bits & (1 << (31 - i))) {
          found.push((base + i + 1).toString(16).toUpperCase().padStart(2, '0'));
        }
      }
    }
    return found;
  }

  /* ---------- Protokoll / Log ---------- */

  function startLog() {
    logActive = true;
    logRows = [];
    logStart = Date.now();
    emit('log', { active: true, rows: 0 });
  }

  function stopLog() {
    if (!logActive) return logRows.slice();
    logActive = false;
    emit('log', { active: false, rows: logRows.length });
    return logRows.slice();
  }

  on('value', (e) => {
    if (!logActive) return;
    const def = PIDS[e.key];
    logRows.push({
      t: Date.now(),
      ms: Date.now() - logStart,
      key: e.key,
      name: def ? def.name : e.key,
      value: Math.round(e.value * 100) / 100,
      unit: def ? def.unit : '',
      raw: e.raw
    });
    if (logRows.length % 40 === 0) emit('log', { active: true, rows: logRows.length });
  });

  /* ---------- Zugriff für die Oberfläche ---------- */

  function snapshot() {
    return {
      live: connected && Date.now() - live.at < 5000,
      kind,
      name: elmName || (transport && transport.name) || '',
      speed: live.speed,
      rpm: live.rpm,
      coolant: live.coolant,
      intake: live.intake,
      load: live.load,
      throttle: live.throttle,
      maf: live.maf,
      map: live.map,
      fuel: live.fuel,
      volt: live.volt,
      cons: live.cons,
      consSrc: live.consSrc,
      at: live.at
    };
  }

  window.FahrtOBD = {
    connect,
    disconnect,
    isConnected: () => connected,
    kind: () => kind,
    pids: PIDS,
    readPid,
    readDtc,
    clearDtc,
    scanSupported,
    startPolling,
    stopPolling,
    startLog,
    stopLog,
    logRows: () => logRows.slice(),
    history: () => history.slice(),
    snapshot,
    on,
    off,
    command: (cmd, ms) => (elm ? elm.command(cmd, ms) : Promise.reject(new Error('Nicht verbunden.')))
  };
})();
