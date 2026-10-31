/* Fahrtprofil – Servicebuch
 * Kilometerstand und vier Fristen: Ölwechsel, CSDD (TÜV), Ölstand, Wischwasser.
 * Alles bleibt lokal im Gerät (localStorage), es wird nichts übertragen.
 */
(function () {
  'use strict';

  const KEY = 'fahrtprofil.service.v1';
  const DAY = 86400000;
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const df = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  /* ---------- Ablage ---------- */

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      return d && typeof d === 'object' ? d : {};
    } catch (e) { return {}; }
  }
  function save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* voll oder gesperrt */ }
  }

  let data = load();
  let kmNow = null;     // geschätzter aktueller Kilometerstand
  let editing = null;   // 'odo' oder Schlüssel der Karte, die gerade bearbeitet wird

  /* ---------- Hilfen ---------- */

  const todayIso = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const parse = (iso) => { const t = Date.parse(iso + 'T12:00:00'); return isNaN(t) ? null : t; };
  const fmtDate = (iso) => { const t = parse(iso); return t == null ? '–' : df.format(new Date(t)); };
  const daysFrom = (iso) => { const t = parse(iso); return t == null ? null : Math.floor((Date.now() - t) / DAY); };
  const addMonths = (iso, m) => {
    const d = new Date(parse(iso));
    d.setMonth(d.getMonth() + m);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dayText = (n) => (Math.abs(n) === 1 ? '1 Tag' : Math.abs(n) + ' Tage');

  /* Kilometerstand: letzter Eintrag plus die seither gespeicherten Fahrten */
  async function estimateKm() {
    const o = data.odo;
    if (!o || typeof o.km !== 'number') { kmNow = null; return; }
    let add = 0;
    try {
      if (window.TripStore) {
        const list = await TripStore.list();
        const since = parse(o.date);
        list.forEach((t) => {
          const when = Date.parse(t.date);
          if (since != null && !isNaN(when) && when > since + DAY) add += t.km || 0;
        });
      }
    } catch (e) { /* ohne Fahrten bleibt der letzte Eintrag */ }
    kmNow = Math.round(o.km + add);
  }

  /* ---------- Karten ---------- */

  const ITEMS = [
    { key: 'oil', title: 'Ölwechsel', kind: 'kmtime', done: 'Ölwechsel erledigt',
      defaults: { intervalKm: 15000, intervalMonths: 12 } },
    { key: 'csdd', title: 'CSDD · Hauptuntersuchung', kind: 'date', done: 'Prüfung bestanden',
      defaults: { intervalMonths: 24 } },
    { key: 'oilLevel', title: 'Ölstand', kind: 'check', done: 'Ölstand geprüft',
      defaults: { intervalDays: 30 } },
    { key: 'washer', title: 'Wischwasser', kind: 'check', done: 'Aufgefüllt',
      defaults: { intervalDays: 30 } }
  ];

  /** Ergebnis: { state: unset|ok|soon|due, headline, detail, frac } */
  function status(it) {
    const d = data[it.key];
    if (!d) return { state: 'unset', headline: 'Noch nicht eingerichtet', detail: '', frac: 0 };

    if (it.kind === 'kmtime') {
      const byTime = daysFrom(d.lastDate);
      const totalDays = Math.max(1, Math.round(d.intervalMonths * 30.44));
      let frac = byTime == null ? 0 : byTime / totalDays;
      let left = [];
      if (byTime != null) left.push(Math.max(0, totalDays - byTime) > 0 ? 'noch ' + dayText(totalDays - byTime) : 'Zeit überschritten');
      if (kmNow != null && typeof d.lastKm === 'number' && d.intervalKm > 0) {
        const used = kmNow - d.lastKm;
        frac = Math.max(frac, used / d.intervalKm);
        left.unshift(used < d.intervalKm ? 'noch ' + nf.format(d.intervalKm - used) + ' km' : nf.format(used - d.intervalKm) + ' km überfällig');
      }
      const state = frac >= 1 ? 'due' : frac >= 0.85 ? 'soon' : 'ok';
      return {
        state, frac,
        headline: left.join(' · ') || 'Kilometerstand eintragen',
        detail: 'Letzter Wechsel ' + fmtDate(d.lastDate) + (typeof d.lastKm === 'number' ? ' bei ' + nf.format(d.lastKm) + ' km' : '') +
          ' · alle ' + nf.format(d.intervalKm) + ' km / ' + d.intervalMonths + ' Monate'
      };
    }

    if (it.kind === 'date') {
      const t = parse(d.due);
      if (t == null) return { state: 'unset', headline: 'Noch nicht eingerichtet', detail: '', frac: 0 };
      const left = Math.ceil((t - Date.now()) / DAY);
      const state = left < 0 ? 'due' : left <= 60 ? 'soon' : 'ok';
      return {
        state, frac: Math.min(1, Math.max(0, 1 - left / 730)),
        headline: left < 0 ? 'seit ' + dayText(left) + ' überfällig' : left === 0 ? 'heute fällig' : 'noch ' + dayText(left),
        detail: 'Fällig am ' + fmtDate(d.due) + ' · Intervall ' + d.intervalMonths + ' Monate'
      };
    }

    const ago = daysFrom(d.lastDate);
    if (ago == null) return { state: 'unset', headline: 'Noch nicht eingerichtet', detail: '', frac: 0 };
    const left = d.intervalDays - ago;
    const state = left <= 0 ? 'due' : left <= 7 ? 'soon' : 'ok';
    return {
      state, frac: Math.min(1, ago / d.intervalDays),
      headline: left <= 0 ? 'Kontrolle überfällig' : 'Nächste Kontrolle in ' + dayText(left),
      detail: 'Zuletzt ' + fmtDate(d.lastDate) + (ago === 0 ? ' (heute)' : ' (vor ' + dayText(ago) + ')') + ' · alle ' + d.intervalDays + ' Tage'
    };
  }

  const STATE_LABEL = { unset: 'Einrichten', ok: 'In Ordnung', soon: 'Bald fällig', due: 'Fällig' };

  function field(label, name, type, value, extra) {
    return '<label class="sv-field"><span>' + label + '</span><input name="' + name + '" type="' + type + '" value="' +
      esc(value == null ? '' : value) + '" ' + (extra || '') + '></label>';
  }

  function editForm(it) {
    const d = data[it.key] || {};
    const df0 = it.defaults;
    let f = '';
    if (it.kind === 'kmtime') {
      f += field('Letzter Wechsel am', 'lastDate', 'date', d.lastDate || todayIso());
      f += field('Kilometerstand beim Wechsel', 'lastKm', 'number', d.lastKm != null ? d.lastKm : (kmNow != null ? kmNow : ''), 'inputmode="numeric" min="0"');
      f += field('Intervall (km)', 'intervalKm', 'number', d.intervalKm || df0.intervalKm, 'inputmode="numeric" min="1000"');
      f += field('Intervall (Monate)', 'intervalMonths', 'number', d.intervalMonths || df0.intervalMonths, 'inputmode="numeric" min="1"');
    } else if (it.kind === 'date') {
      f += field('Nächster Termin', 'due', 'date', d.due || addMonths(todayIso(), 12));
      f += field('Intervall (Monate)', 'intervalMonths', 'number', d.intervalMonths || df0.intervalMonths, 'inputmode="numeric" min="1"');
    } else {
      f += field('Zuletzt geprüft am', 'lastDate', 'date', d.lastDate || todayIso());
      f += field('Erinnerung alle (Tage)', 'intervalDays', 'number', d.intervalDays || df0.intervalDays, 'inputmode="numeric" min="1"');
    }
    return '<form class="sv-form" data-form="' + it.key + '">' + f +
      '<div class="sv-actions"><button class="sv-btn primary" type="submit">Speichern</button>' +
      '<button class="sv-btn" type="button" data-act="cancel">Abbrechen</button>' +
      (data[it.key] ? '<button class="sv-btn danger" type="button" data-act="remove" data-key="' + it.key + '">Entfernen</button>' : '') +
      '</div></form>';
  }

  function cardHtml(it) {
    const s = status(it);
    const bar = s.state === 'unset' ? '' :
      '<div class="sv-bar"><i style="width:' + Math.round(Math.min(1, s.frac) * 100) + '%"></i></div>';
    let body;
    if (editing === it.key) {
      body = editForm(it);
    } else {
      const doneLabel = it.done;
      body = '<div class="sv-headline">' + esc(s.headline) + '</div>' + bar +
        (s.detail ? '<div class="sv-detail">' + esc(s.detail) + '</div>' : '') +
        '<div class="sv-actions">' +
        (s.state === 'unset'
          ? '<button class="sv-btn primary" data-act="edit" data-key="' + it.key + '">Einrichten</button>'
          : '<button class="sv-btn primary" data-act="done" data-key="' + it.key + '">' + doneLabel + '</button>' +
            '<button class="sv-btn" data-act="edit" data-key="' + it.key + '">Bearbeiten</button>') +
        '</div>';
    }
    return '<article class="sv-card state-' + s.state + '"><header><h3>' + it.title + '</h3>' +
      '<span class="sv-pill">' + STATE_LABEL[s.state] + '</span></header>' + body + '</article>';
  }

  function odoHtml() {
    const o = data.odo;
    let body;
    if (editing === 'odo') {
      body = '<form class="sv-form" data-form="odo">' +
        field('Kilometerstand laut Tacho', 'km', 'number', o ? kmNow : '', 'inputmode="numeric" min="0" required') +
        '<div class="sv-actions"><button class="sv-btn primary" type="submit">Speichern</button>' +
        '<button class="sv-btn" type="button" data-act="cancel">Abbrechen</button></div></form>';
    } else if (o && kmNow != null) {
      body = '<div class="sv-odo"><b>' + nf.format(kmNow) + '</b><span>km</span></div>' +
        '<div class="sv-detail">Eintrag vom ' + fmtDate(o.date) + ': ' + nf.format(o.km) + ' km, dazu die seither gespeicherten Fahrten</div>' +
        '<div class="sv-actions"><button class="sv-btn primary" data-act="edit" data-key="odo">Tachostand eintragen</button></div>';
    } else {
      body = '<div class="sv-headline">Noch kein Kilometerstand</div>' +
        '<div class="sv-detail">Trag den Tachostand einmal ein. Danach zählt die App jede gespeicherte Fahrt dazu.</div>' +
        '<div class="sv-actions"><button class="sv-btn primary" data-act="edit" data-key="odo">Eintragen</button></div>';
    }
    return '<article class="sv-card sv-odocard"><header><h3>Kilometerstand</h3></header>' + body + '</article>';
  }

  function render() {
    const host = $('serviceBody');
    if (!host) return;
    host.innerHTML = odoHtml() + ITEMS.map(cardHtml).join('');
    updateBadge();
  }

  function dueCount() {
    return ITEMS.reduce((n, it) => {
      const st = status(it).state;
      return n + (st === 'due' || st === 'soon' ? 1 : 0);
    }, 0);
  }
  function updateBadge() {
    if (window.FahrtNav) FahrtNav.setBadge(dueCount());
  }

  /* ---------- Aktionen ---------- */

  function markDone(key) {
    const it = ITEMS.find((x) => x.key === key);
    const d = data[key];
    if (!it || !d) return;
    const today = todayIso();
    if (it.kind === 'kmtime') { d.lastDate = today; if (kmNow != null) d.lastKm = kmNow; }
    else if (it.kind === 'date') { d.due = addMonths(today, d.intervalMonths || 24); }
    else { d.lastDate = today; }
    save(data);
    toast(it.title + ': eingetragen');
    render();
  }

  function submit(form) {
    const key = form.dataset.form;
    const v = {};
    new FormData(form).forEach((val, k) => { v[k] = val; });
    if (key === 'odo') {
      const km = parseInt(v.km, 10);
      if (!(km >= 0)) return toast('Bitte einen gültigen Kilometerstand eingeben.');
      data.odo = { km, date: todayIso() };
      save(data);
      editing = null;
      return estimateKm().then(render);
    }
    const it = ITEMS.find((x) => x.key === key);
    if (!it) return;
    const n = (x) => { const r = parseInt(x, 10); return r > 0 ? r : null; };
    if (it.kind === 'kmtime') {
      if (!n(v.intervalKm) || !n(v.intervalMonths) || !parse(v.lastDate)) return toast('Bitte alle Felder ausfüllen.');
      const lk = parseInt(v.lastKm, 10);
      data[key] = { lastDate: v.lastDate, lastKm: lk >= 0 ? lk : null, intervalKm: n(v.intervalKm), intervalMonths: n(v.intervalMonths) };
    } else if (it.kind === 'date') {
      if (!parse(v.due) || !n(v.intervalMonths)) return toast('Bitte alle Felder ausfüllen.');
      data[key] = { due: v.due, intervalMonths: n(v.intervalMonths) };
    } else {
      if (!parse(v.lastDate) || !n(v.intervalDays)) return toast('Bitte alle Felder ausfüllen.');
      data[key] = { lastDate: v.lastDate, intervalDays: n(v.intervalDays) };
    }
    save(data);
    editing = null;
    render();
  }

  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- Seite öffnen und schließen ---------- */

  let timer = null;

  function open() {
    const page = $('servicePage');
    if (!page) return;
    clearTimeout(timer);
    page.hidden = false;
    void page.offsetWidth;
    page.classList.add('open');
    document.body.classList.add('page-open');
    const app = document.querySelector('.app');
    if (app) app.inert = true;
    editing = null;
    estimateKm().then(render);
  }

  function close() {
    const page = $('servicePage');
    if (!page || page.hidden) return;
    page.classList.remove('open');
    document.body.classList.remove('page-open');
    const app = document.querySelector('.app');
    if (app) app.inert = false;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!page.classList.contains('open')) page.hidden = true; }, 240);
  }

  function init() {
    const host = $('serviceBody');
    if (host) {
      host.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'edit') { editing = b.dataset.key; render(); }
        else if (act === 'cancel') { editing = null; render(); }
        else if (act === 'done') markDone(b.dataset.key);
        else if (act === 'remove') {
          if (window.confirm('Eintrag löschen?')) { delete data[b.dataset.key]; save(data); editing = null; render(); }
        }
      });
      host.addEventListener('submit', (e) => { e.preventDefault(); submit(e.target); });
    }
    // Hinweis-Zähler auch ohne geöffnete Seite
    estimateKm().then(updateBadge);
  }

  window.FahrtService = { open, close, alerts: dueCount };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
