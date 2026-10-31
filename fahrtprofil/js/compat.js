/* Fahrtprofil – Ersatz für "gap" in Flexbox
 * Ältere Android-WebViews (z. B. Chrome 79 auf manchen Auto-Radios) kennen gap nur
 * für Grid. Dort ersetzt dieses Skript den Abstand durch Außenabstände der Kinder.
 * Mit ?forcegap in der Adresse lässt sich das Verhalten im Browser testen.
 */
(function () {
  'use strict';

  function flexGapSupported() {
    try {
      const f = document.createElement('div');
      f.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
      f.appendChild(document.createElement('div'));
      f.appendChild(document.createElement('div'));
      document.body.appendChild(f);
      const ok = f.scrollHeight === 1;
      f.remove();
      return ok;
    } catch (e) { return true; }
  }

  const force = /[?&]forcegap\b/.test(location.search);
  let styleEl = null;

  function px(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function fix(root) {
    if (styleEl) styleEl.disabled = true; // nur im Testmodus: echte Werte lesen
    const list = root.querySelectorAll ? root.querySelectorAll('*') : [];
    const all = root.nodeType === 1 ? [root].concat(Array.prototype.slice.call(list)) : Array.prototype.slice.call(list);
    const jobs = [];
    all.forEach((el) => {
      if (el.__gapDone) return;
      const cs = getComputedStyle(el);
      if (cs.display !== 'flex' && cs.display !== 'inline-flex') return;
      const col = px(cs.columnGap), row = px(cs.rowGap);
      if (!col && !row) return;
      jobs.push({ el, col, row, dir: cs.flexDirection, wrap: cs.flexWrap !== 'nowrap' });
    });
    jobs.forEach((j) => {
      j.el.__gapDone = true;
      const kids = Array.prototype.filter.call(j.el.children, (k) => !k.hidden);
      const vertical = j.dir.indexOf('column') === 0;
      kids.forEach((k, i) => {
        if (j.wrap) {
          // Umbrechende Zeilen: Abstand rechts und unten, Container gleicht den Rand aus
          if (j.col) k.style.marginRight = j.col + 'px';
          if (j.row) k.style.marginBottom = j.row + 'px';
        } else if (i > 0) {
          if (vertical) { if (j.row) k.style.marginTop = j.row + 'px'; }
          else if (j.col) k.style.marginLeft = j.col + 'px';
        }
      });
      if (j.wrap) {
        if (j.col) j.el.style.marginRight = (px(j.el.style.marginRight) - j.col) + 'px';
        if (j.row) j.el.style.marginBottom = (px(j.el.style.marginBottom) - j.row) + 'px';
      }
    });
    if (force && jobs.length && !styleEl) {
      styleEl = document.createElement('style');
      styleEl.textContent = '*{gap:0!important}';
      document.head.appendChild(styleEl);
    }
    if (styleEl) styleEl.disabled = false;
  }

  function start() {
    if (!force && flexGapSupported()) return;
    document.documentElement.classList.add('no-flex-gap');
    fix(document.body);
    let timer = null;
    const queue = [];
    new MutationObserver((muts) => {
      muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) queue.push(n); }));
      if (!queue.length || timer) return;
      timer = setTimeout(() => {
        timer = null;
        queue.splice(0).forEach((n) => { if (document.body.contains(n)) fix(n); });
      }, 30);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
