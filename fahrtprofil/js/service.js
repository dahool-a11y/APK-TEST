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
    { key: 'csdd', title: 'CSDD-Prüfung', kind: 'date', done: 'Prüfung bestanden',
      defaults: { intervalMonths: 24 } },
    { key: 'oilLevel', title: 'Ölstand', kind: 'check', done: 'Ölstand geprüft',
      defaults: { intervalDays: 30 } },
    { key: 'washer', title: 'Wischwasser', kind: 'check', done: 'Aufgefüllt',
      defaults: { intervalDays: 30 } }
  ];

  /** Ergebnis: { state: unset|ok|soon|due, frac, value, unit, meta }
   *  value/unit ist die große Zahl neben dem Symbol, meta die leise Zeile darunter. */
  function status(it) {
    const d = data[it.key];
    if (!d) return { state: 'unset', frac: 0, value: '–', unit: '', meta: '' };

    if (it.kind === 'kmtime') {
      const byTime = daysFrom(d.lastDate);
      const totalDays = Math.max(1, Math.round(d.intervalMonths * 30.44));
      let frac = byTime == null ? 0 : byTime / totalDays;
      let leftDays = byTime == null ? null : totalDays - byTime;
      let leftKm = null;

      if (kmNow != null && typeof d.lastKm === 'number' && d.intervalKm > 0) {
        const used = kmNow - d.lastKm;
        frac = Math.max(frac, used / d.intervalKm);
        leftKm = d.intervalKm - used;
      }
      const state = frac >= 1 ? 'due' : frac >= 0.85 ? 'soon' : 'ok';

      let value, unit;
      if (leftKm != null) {
        value = nf.format(Math.abs(leftKm));
        unit = leftKm < 0 ? 'km über' : 'km';
      } else if (leftDays != null) {
        value = nf.format(Math.abs(leftDays));
        unit = leftDays < 0 ? 'Tage über' : 'Tage';
      } else {
        value = '–'; unit = '';
      }
      return {
        state, frac, value, unit,
        meta: (typeof d.lastKm === 'number' ? 'seit ' + fmtDate(d.lastDate) : 'am ' + fmtDate(d.lastDate)) +
          ' · alle ' + nf.format(d.intervalKm) + ' km'
      };
    }

    if (it.kind === 'date') {
      const t = parse(d.due);
      if (t == null) return { state: 'unset', frac: 0, value: '–', unit: '', meta: '' };
      const left = Math.ceil((t - Date.now()) / DAY);
      const state = left < 0 ? 'due' : left <= 60 ? 'soon' : 'ok';
      return {
        state, frac: Math.min(1, Math.max(0, 1 - left / 730)),
        value: nf.format(Math.abs(left)), unit: left < 0 ? 'Tage über' : 'Tage',
        meta: 'Termin ' + fmtDate(d.due)
      };
    }

    const ago = daysFrom(d.lastDate);
    if (ago == null) return { state: 'unset', frac: 0, value: '–', unit: '', meta: '' };
    const left = d.intervalDays - ago;
    const state = left <= 0 ? 'due' : left <= 7 ? 'soon' : 'ok';
    return {
      state, frac: Math.min(1, ago / d.intervalDays),
      value: nf.format(Math.abs(left)), unit: left < 0 ? 'Tage über' : 'Tage',
      meta: 'zuletzt ' + fmtDate(d.lastDate)
    };
  }

  const STATE_LABEL = { unset: 'Nicht eingerichtet', ok: 'In Ordnung', soon: 'Bald fällig', due: 'Fällig' };

  /* ---------- Symbole ---------- */

  const svg = (body) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';

  const ICONS = {
    odo: svg('<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l3.6-4.9"/><circle cx="12" cy="17" r="1.7" fill="currentColor" stroke="none"/>'),
    oil: svg('<path d="M10 3h4v3.2l2 2.8V21H8V9l2-2.8z"/><path d="M8 13h8"/><path d="M10 3h4"/>'),
    csdd: svg('<path d="M12 3l7 3v5.6c0 4.2-2.9 7.6-7 9.4-4.1-1.8-7-5.2-7-9.4V6z"/><path d="M9 11.8l2.2 2.3 4.3-4.3"/>'),
    oilLevel: svg('<path d="M12 3.2s5.6 5.9 5.6 9.6a5.6 5.6 0 0 1-11.2 0c0-3.7 5.6-9.6 5.6-9.6z"/><path d="M9.4 14.2h5.2"/>'),
    washer: svg('<path d="M9 8.5h4.5A2.5 2.5 0 0 1 16 11v9H7v-9a2.5 2.5 0 0 1 2-2.5z"/><path d="M9 8.5V5.5h4"/><path d="M16.5 5.5H20"/><path d="M18 3v5"/>'),
    plus: svg('<path d="M12 5.5v13"/><path d="M5.5 12h13"/>'),
    check: svg('<path d="M5 12.6l4.6 4.6L19 7.5"/>'),
    pencil: svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 6.5l3 3"/>'),
    trash: svg('<path d="M5 7h14"/><path d="M10 4h4"/><path d="M7.5 7l1 13h7l1-13"/>')
  };

  const icon = (key) => '<span class="sv-ico" aria-hidden="true">' + (ICONS[key] || '') + '</span>';

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
    return '<form class="sv-form" data-form="' + it.key + '">' +
      '<div class="sv-fields">' + f + '</div>' +
      '<div class="sv-formbar"><button class="sv-btn primary" type="submit">Speichern</button>' +
      '<button class="sv-btn" type="button" data-act="cancel">Abbrechen</button>' +
      (data[it.key] ? '<button class="sv-btn danger" type="button" data-act="remove" data-key="' + it.key + '">' + ICONS.trash + 'Löschen</button>' : '') +
      '</div></form>';
  }

  function actionButtons(it, set) {
    if (editing === it.key) return '';
    if (!set) {
      return '<button class="sv-btn sv-ico-btn sv-setup" data-act="edit" data-key="' + it.key + '" ' +
        'title="Einrichten" aria-label="' + it.title + ' einrichten">' + ICONS.plus + '<span>Einrichten</span></button>';
    }
    return '<button class="sv-btn sv-ico-btn done" data-act="done" data-key="' + it.key + '" ' +
      'title="' + it.done + '" aria-label="' + it.done + '">' + ICONS.check + '</button>' +
      '<button class="sv-btn sv-ico-btn" data-act="edit" data-key="' + it.key + '" ' +
      'title="Werte ändern" aria-label="' + it.title + ' bearbeiten">' + ICONS.pencil + '</button>';
  }

  function cardHtml(it) {
    const s = status(it);
    const set = s.state !== 'unset';
    const bar = set ? '<div class="sv-bar"><i style="width:' + Math.round(Math.min(1, s.frac) * 100) + '%"></i></div>' : '';
    let body;
    if (editing === it.key) {
      body = '<div class="sv-row">' + icon(it.key) +
        '<div class="sv-main"><span class="sv-name">' + it.title + '</span></div></div>' + editForm(it);
    } else {
      body = '<div class="sv-row">' + icon(it.key) +
        '<div class="sv-main">' +
          '<span class="sv-name">' + it.title + '<i class="sv-dot" title="' + STATE_LABEL[s.state] + '"></i></span>' +
          '<span class="sv-value">' + s.value + (s.unit ? '<small>' + s.unit + '</small>' : '') + '</span>' +
          (s.meta ? '<span class="sv-meta">' + esc(s.meta) + '</span>' : '') +
          bar +
        '</div>' +
        '<div class="sv-btns">' + actionButtons(it, set) + '</div>' +
        '</div>';
    }
    return '<article class="sv-card state-' + s.state + (editing === it.key ? ' editing' : '') + '">' + body + '</article>';
  }

  function odoHtml() {
    const o = data.odo;
    let body;
    if (editing === 'odo') {
      body = '<div class="sv-row">' + icon('odo') +
        '<div class="sv-main"><span class="sv-name">Kilometerstand</span></div></div>' +
        '<form class="sv-form" data-form="odo">' +
        '<div class="sv-fields">' + field('Tachostand', 'km', 'number', o ? kmNow : '', 'inputmode="numeric" min="0" required') + '</div>' +
        '<div class="sv-formbar"><button class="sv-btn primary" type="submit">Speichern</button>' +
        '<button class="sv-btn" type="button" data-act="cancel">Abbrechen</button></div></form>';
    } else {
      const set = !!(o && kmNow != null);
      body = '<div class="sv-row">' + icon('odo') +
        '<div class="sv-main">' +
          '<span class="sv-name">Kilometerstand<i class="sv-dot" title="' + (set ? 'Aus Fahrten fortgeschrieben' : 'Nicht eingetragen') + '"></i></span>' +
          '<span class="sv-value">' + (set ? nf.format(kmNow) + '<small>km</small>' : '–') + '</span>' +
          '<span class="sv-meta">' + (set ? 'Tacho ' + fmtDate(o.date) + ' + Fahrten' : '') + '</span>' +
        '</div>' +
        '<div class="sv-btns">' + (editing === 'odo' ? '' :
          set
            ? '<button class="sv-btn sv-ico-btn" data-act="edit" data-key="odo" title="Tachostand neu eintragen" aria-label="Tachostand neu eintragen">' + ICONS.pencil + '</button>'
            : '<button class="sv-btn sv-ico-btn sv-setup" data-act="edit" data-key="odo" title="Tachostand eintragen" aria-label="Tachostand eintragen">' + ICONS.plus + '<span>Eintragen</span></button>') +
        '</div></div>';
    }
    return '<article class="sv-card sv-odocard state-' + (data.odo ? 'ok' : 'unset') + (editing === 'odo' ? ' editing' : '') + '">' + body + '</article>';
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
