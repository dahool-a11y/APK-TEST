/* Fahrtprofil – Navigation zwischen Tracking, Fahrtenbuch und Service
 * Drei große Reiter, die in der Kopfzeile und im Kopf jeder Seite stehen.
 * Die Ansicht wird aus dem Zustand der Seiten abgeleitet, damit sie
 * nie von der Anzeige abweicht (auch nicht, wenn app.js eine Seite schließt).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ICONS = {
    track: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.3" stroke="currentColor" stroke-width="1.8"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4h11a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 17 21H6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 4v17M10 9h5M10 13h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    service: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.5 6.2a4.2 4.2 0 0 0 4.9 5.6l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.6-8.6a4.2 4.2 0 0 0-2.1-2.8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
  };
  const VIEWS = [
    { id: 'track', label: 'Tracking' },
    { id: 'log', label: 'Fahrtenbuch' },
    { id: 'service', label: 'Service' }
  ];

  let current = 'track';
  let badge = 0;

  function render() {
    document.querySelectorAll('[data-nav]').forEach((slot) => {
      slot.innerHTML = VIEWS.map((v) =>
        '<button type="button" class="nav-btn' + (v.id === current ? ' active' : '') + '" data-view="' + v.id + '"' +
        (v.id === current ? ' aria-current="page"' : '') + '>' +
        ICONS[v.id] + '<span>' + v.label + '</span>' +
        (v.id === 'service' && badge > 0 ? '<b class="nav-badge">' + badge + '</b>' : '') +
        '</button>'
      ).join('');
    });
  }

  function detect() {
    const service = $('servicePage');
    const trips = $('tripsDrawer');
    if (service && !service.hidden && service.classList.contains('open')) return 'service';
    if (trips && !trips.hidden && trips.classList.contains('open')) return 'log';
    return 'track';
  }

  function sync() {
    const next = detect();
    if (next === current) return;
    current = next;
    document.body.dataset.view = current;
    render();
  }

  function go(view) {
    if (view === current) return;
    const tripsOpen = detect() === 'log';
    const serviceOpen = detect() === 'service';
    // Erst schließen, dann öffnen, damit der Hintergrund-Sperrzustand stimmt
    if (tripsOpen) $('tripsClose').click();
    if (serviceOpen && window.FahrtService) FahrtService.close();
    if (view === 'log') $('btnTrips').click();
    if (view === 'service' && window.FahrtService) FahrtService.open();
    setTimeout(sync, 0);
  }

  /** Zurück-Taste: von Fahrtenbuch/Service zurück zum Tracking. */
  function back() {
    if (current === 'track') return false;
    go('track');
    return true;
  }

  function setBadge(n) {
    if (n === badge) return;
    badge = n;
    render();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.nav-btn');
    if (btn) go(btn.dataset.view);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current === 'service') { back(); }
  });

  function init() {
    document.body.dataset.view = 'track';
    render();
    const obs = new MutationObserver(sync);
    ['tripsDrawer', 'servicePage'].forEach((id) => {
      const el = $(id);
      if (el) obs.observe(el, { attributes: true, attributeFilter: ['class', 'hidden'] });
    });
  }

  window.FahrtNav = { go, back, setBadge, current: () => current };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
