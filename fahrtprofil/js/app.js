(function () {
  'use strict';

  const CONS_MAX = 16;
  const SCALE = [
    [0.00, [35, 168, 107]],
    [0.18, [61, 220, 132]],
    [0.38, [185, 227, 75]],
    [0.55, [255, 209, 102]],
    [0.72, [255, 157, 61]],
    [0.88, [255, 92, 92]],
    [1.00, [198, 47, 61]]
  ];
  const PHASE = {
    'Stadt': { band: 'rgba(125,211,252,0.05)', dot: '#7dd3fc' },
    'Landstraße': { band: 'rgba(255,209,102,0.045)', dot: '#ffd166' },
    'Autobahn': { band: 'rgba(167,139,250,0.06)', dot: '#a78bfa' }
  };

  const rec = {
    active: false,
    watchId: null,
    points: [],
    start: 0,
    distance: 0,
    timer: 0,
    lastFix: 0,
    last: null,
    line: null,
    marker: null,
    circle: null
  };

  const $ = (id) => document.getElementById(id);
  const fmt1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const dateFmt = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const state = {
    trip: null,
    hover: -1,
    selected: -1,
    playIdx: 0,
    playing: false,
    follow: true
  };

  let map;
  let routeLayer;
  let hoverMarker = null;
  let selectedMarker = null;
  let carMarker = null;
  let layerPts = null;

  let chart = { w: 0, h: 0, dpr: 1, padL: 44, padR: 16, padT: 24, padB: 24, yMax: 20, xMax: 1 };
  let staticCanvas = null;
  let playRAF = 0;
  let lastFrame = 0;
  let toastTimer = 0;

  const canvas = $('chart');
  const chartWrap = $('chartWrap');
  const chartTip = $('chartTip');
  const detailCard = $('detailCard');
  const detailClose = $('detailClose');
  const tripsDrawer = $('tripsDrawer');
  const appRoot = document.querySelector('.app');
  let drawerTimer = 0;
  let tripsOpener = null;

  init();

  function init() {
    setupMap();
    bindUI();
    setupPWA();
    refreshTrips();
    resizeChart();
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        resizeChart();
        if (map) map.invalidateSize();
      }).observe(chartWrap);
    }
    window.addEventListener('resize', () => {
      resizeChart();
      if (map) map.invalidateSize();
    });
    requestAnimationFrame(() => {
      resizeChart();
      if (map) map.invalidateSize();
      startTrip(TripSim.buildSimulation(Date.now()), true);
      window.__fahrt = { map, state, store: window.TripStore };
    });
  }

  /* ---------------- Karte ---------------- */

  function setupMap() {
    map = L.map('map', {
      zoomControl: false,
      preferCanvas: true,
      minZoom: 4,
      maxZoom: 18,
      zoomSnap: 0.5,
      attributionControl: true
    });
    map.setView([48.03, 11.38], 10);

    if (window.OfflineBasemap) {
      window.OfflineBasemap().addTo(map);
      if (window.BASEMAP && window.addPlaceLabels) {
        window.addPlaceLabels(map, window.BASEMAP.places);
      }
    }
    map.attributionControl.setPrefix(false);

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.createPane('routePane');
    map.getPane('routePane').style.zIndex = 410;
    map.createPane('livePane');
    map.getPane('livePane').style.zIndex = 460;

    routeLayer = L.layerGroup().addTo(map);

    map.on('mousemove', onMapMove);
    map.on('click', onMapClick);
    map.on('zoomend moveend viewreset resize', () => { layerPts = null; });
    map.getContainer().addEventListener('mouseleave', clearHover);
  }

  function colorFor(cons) {
    const t = Math.max(0, Math.min(1, cons / CONS_MAX));
    for (let i = 1; i < SCALE.length; i++) {
      if (t <= SCALE[i][0]) {
        const a = SCALE[i - 1], b = SCALE[i];
        const k = (t - a[0]) / (b[0] - a[0] || 1);
        const rgb = a[1].map((v, j) => Math.round(v + (b[1][j] - v) * k));
        return 'rgb(' + rgb.join(',') + ')';
      }
    }
    const c = SCALE[SCALE.length - 1][1];
    return 'rgb(' + c.join(',') + ')';
  }

  function renderRoute() {
    routeLayer.clearLayers();
    const pts = state.trip.points;
    const coords = pts.map((p) => [p.lat, p.lng]);

    L.polyline(coords, {
      color: '#03070b', weight: 12, opacity: 0.8,
      lineCap: 'round', lineJoin: 'round', interactive: false,
      pane: 'routePane'
    }).addTo(routeLayer);

    L.polyline(coords, {
      color: '#ffd166', weight: 17, opacity: 0.055,
      lineCap: 'round', lineJoin: 'round', interactive: false,
      pane: 'routePane'
    }).addTo(routeLayer);

    const chunk = 3;
    for (let i = 0; i < pts.length - 1; i += chunk) {
      const end = Math.min(pts.length, i + chunk + 1);
      const seg = pts.slice(i, end);
      let sum = 0;
      for (const p of seg) sum += p.cons;
      L.polyline(seg.map((p) => [p.lat, p.lng]), {
        color: colorFor(sum / seg.length),
        weight: 5.5,
        opacity: 0.96,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
        pane: 'routePane'
      }).addTo(routeLayer);
    }

    L.marker(coords[0], {
      interactive: false,
      icon: L.divIcon({
        className: 'endpoint-icon',
        html: '<div class="endpoint start"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      })
    }).addTo(routeLayer);

    L.marker(coords[coords.length - 1], {
      interactive: false,
      icon: L.divIcon({
        className: 'endpoint-icon',
        html: '<div class="endpoint end"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      })
    }).addTo(routeLayer);
  }

  function ensureProjection() {
    if (!layerPts) {
      layerPts = state.trip.points.map((p) => map.latLngToLayerPoint([p.lat, p.lng]));
    }
    return layerPts;
  }

  function nearestIndex(layerPoint, maxPx) {
    const pr = ensureProjection();
    const lim = maxPx * maxPx;
    let best = -1, bestD = lim;
    for (let i = 0; i < pr.length; i++) {
      const dx = pr[i].x - layerPoint.x;
      const dy = pr[i].y - layerPoint.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function onMapMove(e) {
    if (!state.trip || state.playing) return;
    const idx = nearestIndex(e.layerPoint, 24);
    if (idx >= 0) {
      if (idx !== state.hover) setHover(idx);
    } else if (state.hover >= 0) {
      clearHover();
    }
  }

  function onMapClick(e) {
    if (!state.trip) return;
    const idx = nearestIndex(e.layerPoint, 34);
    if (idx >= 0) selectPoint(idx);
    else clearSelection();
  }

  function setHover(idx) {
    state.hover = idx;
    const p = state.trip.points[idx];
    if (idx !== state.selected) {
      if (!hoverMarker) {
        hoverMarker = L.circleMarker([p.lat, p.lng], {
          radius: 5, color: '#ffffff', weight: 2,
          fillColor: '#ffd166', fillOpacity: 1, interactive: false
        }).addTo(map);
      } else {
        hoverMarker.setLatLng([p.lat, p.lng]);
      }
    }
    hideMapHint();
    renderDetail();
    drawChart();
  }

  function clearHover() {
    if (state.hover < 0) return;
    state.hover = -1;
    if (hoverMarker) hoverMarker.remove();
    renderDetail();
    drawChart();
  }

  function selectPoint(idx) {
    state.selected = idx;
    const p = state.trip.points[idx];
    if (!selectedMarker) {
      selectedMarker = L.marker([p.lat, p.lng], {
        interactive: false,
        zIndexOffset: 900,
        icon: L.divIcon({
          className: 'sel-icon',
          html: '<div class="sel-pin"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      }).addTo(map);
    } else {
      selectedMarker.setLatLng([p.lat, p.lng]).addTo(map);
    }
    hideMapHint();
    renderDetail();
    drawChart();
  }

  function clearSelection() {
    state.selected = -1;
    if (selectedMarker) selectedMarker.remove();
    renderDetail();
    drawChart();
  }

  function hideMapHint() {
    const hint = $('mapHint');
    if (hint) hint.classList.add('gone');
  }

  /* ---------------- Detailkarte ---------------- */

  function renderDetail() {
    const trip = state.trip;
    if (!trip) return;
    const idx = state.selected >= 0
      ? state.selected
      : state.hover >= 0
        ? state.hover
        : state.playing
          ? Math.floor(state.playIdx)
          : -1;

    if (idx < 0) {
      detailCard.hidden = true;
      return;
    }

    const p = trip.points[idx];
    const locked = state.selected >= 0;
    detailCard.hidden = false;
    detailCard.classList.toggle('locked', locked);
    detailClose.hidden = !locked;

    $('detailPhase').textContent = p.phase || 'Strecke';
    $('detailCons').textContent = p.speed < 1.5 ? '–' : fmt1.format(p.cons);
    $('detailSpeed').textContent = fmt0.format(p.speed) + ' km/h';
    $('detailEle').textContent = fmt0.format(p.ele) + ' m';
    $('detailKm').textContent = fmt1.format(p.dist / 1000) + ' km';
    $('detailTime').textContent = formatClock(p.time);
    $('detailHint').textContent = locked
      ? 'Fixiert · Klick daneben oder Esc löst'
      : 'Klick auf die Karte fixiert den Punkt';
  }

  /* ---------------- Chart ---------------- */

  function resizeChart() {
    const rect = chartWrap.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    chart.w = rect.width;
    chart.h = rect.height;
    chart.dpr = dpr;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    chart.ctx = canvas.getContext('2d');
    chart.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!staticCanvas) staticCanvas = document.createElement('canvas');
    staticCanvas.width = canvas.width;
    staticCanvas.height = canvas.height;
    chart.staticCtx = staticCanvas.getContext('2d');
    chart.staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderChartStatic();
    drawChart();
  }

  function chartGeom() {
    const xMax = Math.max(0.1, state.trip.stats.totalDist / 1000);
    const plotW = chart.w - chart.padL - chart.padR;
    const plotH = chart.h - chart.padT - chart.padB;
    return { xMax, plotW, plotH };
  }

  function xForDist(km, g) {
    return chart.padL + (km / g.xMax) * g.plotW;
  }

  function yForCons(cons, g) {
    return chart.padT + (1 - Math.min(1.04, cons / chart.yMax)) * g.plotH;
  }

  function renderChartStatic() {
    if (!state.trip || !chart.staticCtx || chart.w < 20) return;
    const ctx = chart.staticCtx;
    const { w, h } = chart;
    const pts = state.trip.points;
    const g = chartGeom();

    let maxCons = 0;
    for (const p of pts) if (p.cons > maxCons) maxCons = p.cons;
    chart.yMax = Math.max(16, Math.ceil((maxCons * 1.12) / 4) * 4);

    ctx.clearRect(0, 0, w, h);

    // Abschnitts-Bänder
    if (pts[0].phase) {
      let start = 0;
      for (let i = 1; i <= pts.length; i++) {
        if (i === pts.length || pts[i].phase !== pts[start].phase) {
          const x1 = xForDist(pts[start].dist / 1000, g);
          const x2 = xForDist(pts[Math.min(pts.length - 1, i)].dist / 1000, g);
          const info = PHASE[pts[start].phase];
          if (info && x2 - x1 > 1) {
            ctx.fillStyle = info.band;
            ctx.fillRect(x1, chart.padT, x2 - x1, g.plotH);
          }
          if (x2 - x1 > 52) {
            ctx.fillStyle = 'rgba(255,255,255,0.24)';
            ctx.font = '600 8px Inter, "Segoe UI", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(pts[start].phase.toUpperCase(), x1 + 6, chart.padT + 6);
          }
          start = i;
        }
      }
    }

    // Gitter + Y-Achse
    ctx.font = '9px Inter, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= chart.yMax + 0.001; v += 5) {
      const y = yForCons(v, g);
      ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chart.padL, y);
      ctx.lineTo(w - chart.padR, y);
      ctx.stroke();
      ctx.fillStyle = '#5b6c7f';
      ctx.fillText(fmt0.format(v), chart.padL - 8, y);
    }

    // X-Achse
    const steps = [5, 10, 20, 25, 50, 100, 200];
    const step = steps.find((s) => g.xMax / s <= 8) || 200;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = 0; v <= g.xMax + 0.001; v += step) {
      const x = xForDist(v, g);
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.moveTo(x, chart.padT);
      ctx.lineTo(x, h - chart.padB);
      ctx.stroke();
      ctx.fillStyle = '#5b6c7f';
      ctx.fillText(fmt0.format(v), x, h - chart.padB + 7);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4c5c6d';
    ctx.fillText('km', w - chart.padR, h - chart.padB + 7);

    // Fläche unter der Kurve
    const baseY = yForCons(0, g);
    const grad = ctx.createLinearGradient(0, chart.padT, 0, baseY);
    grad.addColorStop(0, 'rgba(159,182,204,0.16)');
    grad.addColorStop(1, 'rgba(159,182,204,0.01)');
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = xForDist(pts[i].dist / 1000, g);
      const y = yForCons(pts[i].cons, g);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(xForDist(pts[pts.length - 1].dist / 1000, g), baseY);
    ctx.lineTo(xForDist(0, g), baseY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Verbrauchskurve, segmentweise eingefärbt
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const x1 = xForDist(pts[i - 1].dist / 1000, g);
      const y1 = yForCons(pts[i - 1].cons, g);
      const x2 = xForDist(pts[i].dist / 1000, g);
      const y2 = yForCons(pts[i].cons, g);
      if (x2 - x1 < 0.15) continue;
      ctx.strokeStyle = colorFor((pts[i].cons + pts[i - 1].cons) / 2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Stopp-Marker
    if (state.trip.stops && state.trip.stops.length) {
      for (const st of state.trip.stops) {
        const x = xForDist(st.dist / 1000, g);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(x - 0.75, h - chart.padB - 5, 1.5, 5);
      }
    }
  }

  function drawChart() {
    if (!chart.ctx || !state.trip || chart.w < 20) return;
    const ctx = chart.ctx;
    const { w, h } = chart;
    const g = chartGeom();
    ctx.clearRect(0, 0, w, h);
    if (staticCanvas) ctx.drawImage(staticCanvas, 0, 0, w, h);

    const pts = state.trip.points;

    // Wiedergabe-Cursor
    if (state.playIdx > 0 || state.playing) {
      const p = interpAt(state.playIdx);
      const x = xForDist(p.dist / 1000, g);
      const y = yForCons(p.cons, g);
      ctx.strokeStyle = 'rgba(255,209,102,0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, chart.padT);
      ctx.lineTo(x, chart.padT + g.plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
      ctx.strokeStyle = '#0b1118';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Auswahl
    if (state.selected >= 0) {
      const p = pts[state.selected];
      const x = xForDist(p.dist / 1000, g);
      const y = yForCons(p.cons, g);
      ctx.strokeStyle = 'rgba(255,209,102,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chart.padT);
      ctx.lineTo(x, chart.padT + g.plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = colorFor(p.cons);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,209,102,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Hover
    if (state.hover >= 0 && state.hover !== state.selected) {
      const p = pts[state.hover];
      const x = xForDist(p.dist / 1000, g);
      const y = yForCons(p.cons, g);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chart.padT);
      ctx.lineTo(x, chart.padT + g.plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = colorFor(p.cons);
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    updateChartTip();
  }

  function updateChartTip() {
    if (state.hover < 0 || !state.trip || chart.w < 20) {
      chartTip.hidden = true;
      return;
    }
    const p = state.trip.points[state.hover];
    const g = chartGeom();
    const x = xForDist(p.dist / 1000, g);
    const y = yForCons(p.cons, g);
    const km = p.dist / 1000;
    chartTip.innerHTML =
      '<div class="tip-main">' + (p.speed < 1.5 ? '–' : fmt1.format(p.cons)) +
      '<span>L/100 km</span></div>' +
      '<div class="tip-sub">' + fmt1.format(km) + ' km · ' + fmt0.format(p.speed) + ' km/h · ' +
      fmt0.format(p.ele) + ' m</div>';
    chartTip.style.left = Math.max(72, Math.min(chart.w - 72, x)) + 'px';
    chartTip.style.top = Math.max(30, y - 8) + 'px';
    chartTip.hidden = false;
  }

  function indexAtKm(km) {
    const pts = state.trip.points;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].dist / 1000 < km) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(pts[lo - 1].dist / 1000 - km) < Math.abs(pts[lo].dist / 1000 - km)) {
      return lo - 1;
    }
    return lo;
  }

  function interpAt(pos) {
    const pts = state.trip.points;
    const i = Math.max(0, Math.min(pts.length - 2, Math.floor(pos)));
    const f = Math.max(0, Math.min(1, pos - i));
    const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f,
      dist: a.dist + (b.dist - a.dist) * f,
      cons: a.cons + (b.cons - a.cons) * f,
      speed: a.speed + (b.speed - a.speed) * f,
      ele: a.ele + (b.ele - a.ele) * f,
      time: a.time + (b.time - a.time) * f,
      bearing: a.bearing
    };
  }

  /* ---------------- Chart-Events ---------------- */

  canvas.addEventListener('pointermove', (e) => {
    if (!state.trip || chart.w < 20) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const g = chartGeom();
    if (x < chart.padL - 4 || x > chart.w - chart.padR + 4 || y < chart.padT - 8 || y > chart.h - chart.padB + 8) {
      clearHover();
      return;
    }
    const km = ((x - chart.padL) / g.plotW) * g.xMax;
    setHover(indexAtKm(Math.max(0, Math.min(g.xMax, km))));
  });

  canvas.addEventListener('pointerleave', clearHover);

  canvas.addEventListener('click', (e) => {
    if (!state.trip || chart.w < 20) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const g = chartGeom();
    if (x < chart.padL || x > chart.w - chart.padR) return;
    const km = ((x - chart.padL) / g.plotW) * g.xMax;
    selectPoint(indexAtKm(Math.max(0, Math.min(g.xMax, km))));
  });

  /* ---------------- Wiedergabe ---------------- */

  function ensureCar() {
    if (carMarker) return;
    carMarker = L.marker([state.trip.points[0].lat, state.trip.points[0].lng], {
      interactive: false,
      zIndexOffset: 1100,
      icon: L.divIcon({
        className: 'car-icon',
        html: '<div class="car-marker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 19 20l-7-4.1L5 20z" fill="currentColor"/></svg></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      })
    }).addTo(map);
  }

  function updateCar(pos) {
    const p = interpAt(pos);
    ensureCar();
    carMarker.setLatLng([p.lat, p.lng]);
    const el = carMarker.getElement();
    if (el) {
      const svg = el.querySelector('svg');
      if (svg) {
        svg.style.transformOrigin = '12px 12px';
        svg.style.transform = 'rotate(' + p.bearing.toFixed(0) + 'deg)';
      }
    }
    if (state.follow) {
      const size = map.getSize();
      const sp = map.latLngToContainerPoint([p.lat, p.lng]);
      if (sp.x < size.x * 0.22 || sp.x > size.x * 0.78 || sp.y < size.y * 0.22 || sp.y > size.y * 0.78) {
        map.panTo([p.lat, p.lng], { animate: true, duration: 0.5 });
      }
    }
  }

  function startPlay() {
    if (!state.trip) return;
    stopPlay();
    if (state.playIdx >= state.trip.points.length - 1) state.playIdx = 0;
    state.playing = true;
    state.selected = -1;
    state.hover = -1;
    if (selectedMarker) selectedMarker.remove();
    if (hoverMarker) hoverMarker.remove();
    $('btnPlay').classList.add('playing');
    $('btnPlay').setAttribute('aria-label', 'Wiedergabe pausieren');
    hideMapHint();
    lastFrame = performance.now();
    playRAF = requestAnimationFrame(tick);
    renderDetail();
    drawChart();
  }

  function tick(ts) {
    if (!state.playing) return;
    const dt = Math.min(0.12, (ts - lastFrame) / 1000) || 0;
    lastFrame = ts;
    const n = state.trip.points.length;
    state.playIdx = Math.min(n - 1, state.playIdx + dt * ((n - 1) / 55));
    updateCar(state.playIdx);
    updatePlayUI();
    renderDetail();
    drawChart();
    if (state.playIdx >= n - 1) {
      stopPlay(true);
      return;
    }
    playRAF = requestAnimationFrame(tick);
  }

  function stopPlay(finished) {
    state.playing = false;
    if (playRAF) cancelAnimationFrame(playRAF);
    playRAF = 0;
    $('btnPlay').classList.remove('playing');
    $('btnPlay').setAttribute('aria-label', 'Wiedergabe starten');
    if (finished) {
      state.selected = state.trip.points.length - 1;
      if (!selectedMarker) {
        const p = state.trip.points[state.selected];
        selectedMarker = L.marker([p.lat, p.lng], {
          interactive: false,
          zIndexOffset: 900,
          icon: L.divIcon({ className: 'sel-icon', html: '<div class="sel-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })
        }).addTo(map);
      } else {
        const p = state.trip.points[state.selected];
        selectedMarker.setLatLng([p.lat, p.lng]).addTo(map);
      }
    }
    renderDetail();
    drawChart();
  }

  function togglePlay() {
    if (state.playing) stopPlay(false);
    else startPlay();
  }

  function updatePlayUI() {
    const n = state.trip.points.length;
    const val = Math.round((state.playIdx / (n - 1)) * 1000);
    const scrub = $('scrub');
    scrub.value = val;
    scrub.style.setProperty('--p', (val / 10) + '%');
    $('timeCurrent').textContent = formatClock(interpAt(state.playIdx).time);
  }

  function onScrub() {
    if (!state.trip) return;
    if (state.playing) stopPlay(false);
    const n = state.trip.points.length;
    state.playIdx = (Number($('scrub').value) / 1000) * (n - 1);
    state.selected = -1;
    if (selectedMarker) selectedMarker.remove();
    ensureCar();
    updateCar(state.playIdx);
    updatePlayUI();
    renderDetail();
    drawChart();
  }

  /* ---------------- GPS-Aufzeichnung (Android/Browser) ---------------- */

  function toggleRecording() {
    if (rec.active) stopRecording(true);
    else startRecording();
  }

  function startRecording() {
    if (rec.active) return;
    if (!navigator.geolocation) {
      toast('Dieses Gerät stellt keine GPS-Ortung bereit.', true);
      return;
    }
    if (!window.isSecureContext) {
      toast('GPS im Browser nur über HTTPS oder localhost. Für Feldtests die App per HTTPS bereitstellen.', true);
      return;
    }

    stopPlay(false);
    clearSelection();
    clearHover();
    if (carMarker) { carMarker.remove(); carMarker = null; }

    rec.active = true;
    state.recording = true;
    rec.points = [];
    rec.distance = 0;
    rec.start = Date.now();
    rec.lastFix = 0;
    rec.last = null;

    rec.line = L.polyline([], {
      pane: 'livePane', color: '#7dd3fc', weight: 5, opacity: 0.95,
      lineCap: 'round', lineJoin: 'round', interactive: false
    }).addTo(map);

    rec.marker = L.circleMarker([0, 0], {
      pane: 'livePane', radius: 6, color: '#ffffff', weight: 2,
      fillColor: '#7dd3fc', fillOpacity: 0, opacity: 0, interactive: false
    }).addTo(map);

    rec.circle = L.circle([0, 0], {
      pane: 'livePane', radius: 0, color: '#7dd3fc', weight: 1,
      opacity: 0, fillColor: '#7dd3fc', fillOpacity: 0.08, interactive: false
    }).addTo(map);

    document.body.classList.add('recording');
    $('btnRecord').classList.add('recording');
    $('btnRecord').title = 'GPS-Aufzeichnung beenden';
    $('recordLabel').textContent = 'Stopp';
    $('recorder').hidden = false;
    $('recState').textContent = 'GPS wird gesucht …';
    $('recTime').textContent = '0:00';
    $('recDist').textContent = '0 m';
    $('recSpeed').textContent = '–';
    $('recAcc').textContent = '–';
    $('recPoints').textContent = '0';

    hideMapHint();
    rec.timer = setInterval(updateRecUI, 1000);
    rec.watchId = navigator.geolocation.watchPosition(onGps, onGpsError, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 20000
    });
  }

  function onGps(pos) {
    if (!rec.active) return;
    const c = pos.coords;
    const acc = Number.isFinite(c.accuracy) ? c.accuracy : 999;
    const lat = c.latitude;
    const lng = c.longitude;
    // Der Zeitstempel hängt an pos, nicht an pos.coords. Wichtig, wenn die App im
    // Hintergrund Punkte sammelt und gebündelt abliefert.
    const time = (pos.timestamp || Date.now()) / 1000;

    if (acc > 100 && rec.points.length > 0) {
      $('recState').textContent = 'GPS-Genauigkeit schwach …';
      $('recAcc').textContent = fmt0.format(acc) + ' m';
      return;
    }

    let speed = Number.isFinite(c.speed) ? Math.max(0, c.speed * 3.6) : null;
    let step = 0;
    if (rec.last) {
      step = TripSim.haversine(rec.last, { lat, lng });
      const dt = time - rec.last.time;
      if (speed === null && dt > 0.5) speed = Math.max(0, (step / dt) * 3.6);
      if (step < 1.5 && dt < 2) return;
      rec.distance += step;
    }
    rec.last = { lat, lng, time };

    const point = {
      lat,
      lng,
      time,
      ele: Number.isFinite(c.altitude) ? c.altitude : null
    };
    if (speed !== null) point.speed = speed;
    rec.points.push(point);
    rec.lastFix = Date.now();

    rec.line.addLatLng([lat, lng]);
    rec.marker.setLatLng([lat, lng]).setStyle({ opacity: 1, fillOpacity: 1 });
    rec.circle.setLatLng([lat, lng]).setRadius(Math.max(5, Math.min(150, acc))).setStyle({ opacity: 0.35 });

    if (rec.points.length === 1) {
      map.setView([lat, lng], 14);
    } else if (state.follow) {
      const size = map.getSize();
      const sp = map.latLngToContainerPoint([lat, lng]);
      if (sp.x < size.x * 0.2 || sp.x > size.x * 0.8 || sp.y < size.y * 0.2 || sp.y > size.y * 0.8) {
        map.panTo([lat, lng], { animate: true, duration: 0.4 });
      }
    }

    updateRecUI(acc, speed);
  }

  function onGpsError(err) {
    if (!rec.active) return;
    if (err.code === 1) {
      $('recState').textContent = 'GPS-Zugriff verweigert';
      toast('GPS-Zugriff wurde verweigert. Bitte in den Einstellungen erlauben.', true);
      stopRecording(false);
      return;
    }
    $('recState').textContent = err.code === 3 ? 'GPS-Signal schwach …' : 'Kein GPS-Signal …';
  }

  function updateRecUI(acc, speed) {
    if (!rec.active) return;
    $('recTime').textContent = formatClock((Date.now() - rec.start) / 1000);
    $('recPoints').textContent = rec.points.length;
    $('recDist').textContent = rec.distance < 1000
      ? fmt0.format(rec.distance) + ' m'
      : fmt1.format(rec.distance / 1000) + ' km';

    if (speed !== undefined && speed !== null) $('recSpeed').textContent = fmt0.format(speed) + ' km/h';
    if (acc !== undefined && acc !== null) $('recAcc').textContent = fmt0.format(acc) + ' m';

    if (rec.points.length && Date.now() - rec.lastFix < 5000) {
      $('recState').textContent = acc > 40 ? 'GPS-Genauigkeit schwach' : 'Aufzeichnung läuft';
    }
  }

  function stopRecording(save) {
    if (!rec.active) return;
    rec.active = false;
    state.recording = false;
    clearInterval(rec.timer);
    rec.timer = 0;
    if (rec.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(rec.watchId);
    }
    rec.watchId = null;
    if (rec.line) { rec.line.remove(); rec.line = null; }
    if (rec.marker) { rec.marker.remove(); rec.marker = null; }
    if (rec.circle) { rec.circle.remove(); rec.circle = null; }

    document.body.classList.remove('recording');
    $('btnRecord').classList.remove('recording');
    $('btnRecord').title = 'GPS-Aufzeichnung starten';
    $('recordLabel').textContent = 'GPS';
    $('recorder').hidden = true;

    if (!save) {
      toast('Aufzeichnung verworfen');
      return;
    }
    if (rec.points.length < 2) {
      toast('Zu wenige GPS-Punkte – Aufzeichnung verworfen.', true);
      return;
    }

    try {
      const trip = TripSim.finalize(rec.points, {
        name: 'GPS-Aufzeichnung',
        source: 'gps',
        label: 'GPS-Aufzeichnung',
        date: new Date().toISOString()
      });
      startTrip(trip, true);
      saveTrip(trip).then((summary) => {
        if (!summary) return;
        toast('GPS-Aufzeichnung gespeichert · ' + fmt1.format(trip.stats.totalDist / 1000) +
          ' km' + (trip.meta.estimatedCons ? ' · Verbrauch geschätzt' : ''));
      });
    } catch (err) {
      toast(err.message || 'Aufzeichnung konnte nicht ausgewertet werden.', true);
    }
  }

  /* ---------------- Gespeicherte Fahrten ---------------- */

  let tripsCache = [];

  async function refreshTrips() {
    if (!window.TripStore) return;
    try {
      tripsCache = await TripStore.list();
    } catch (err) {
      tripsCache = [];
    }
    renderTripsSummary(tripsCache);
    renderTripsList(tripsCache);
    $('tripListCount').textContent = String(tripsCache.length);
    const badge = $('tripCount');
    badge.textContent = String(tripsCache.length);
    badge.hidden = tripsCache.length === 0;
    $('railTripCount').textContent = String(tripsCache.length);
  }

  function renderTripsSummary(trips) {
    let km = 0, fuel = 0, dur = 0;
    let estimated = false;
    for (const t of trips) {
      km += t.km || 0;
      fuel += t.fuel || 0;
      dur += t.duration || 0;
      if (t.estimatedCons) estimated = true;
    }

    $('sumTrips').textContent = fmt0.format(trips.length);
    $('sumKm').textContent = (km >= 100 || km === 0 ? fmt0.format(km) : fmt1.format(km)) + ' km';
    $('sumKmSub').textContent = trips.length === 0
      ? 'noch keine Fahrt'
      : trips.length === 1 ? 'über 1 Fahrt' : 'über ' + fmt0.format(trips.length) + ' Fahrten';

    const avgEl = $('sumAvg');
    if (km > 0.05) {
      const avg = (fuel / km) * 100;
      avgEl.textContent = fmt1.format(avg) + ' L/100';
      avgEl.style.color = colorFor(avg);
    } else {
      avgEl.textContent = '–';
      avgEl.style.color = '';
    }

    $('sumFuel').textContent = fuel > 0 ? fmt1.format(fuel) + ' L' : '–';
    $('sumFuelSub').textContent = fuel > 0 ? (estimated ? 'teils geschätzt' : 'gemessen') : 'gesamt';
    $('sumTime').textContent = dur > 0
      ? (dur < 3600 ? Math.max(1, Math.round(dur / 60)) + ' min' : formatDuration(dur))
      : '–';
    $('sumSpeed').textContent = dur > 0 ? fmt0.format(km / (dur / 3600)) + ' km/h' : '–';

    $('railArchive').textContent = trips.length === 0
      ? 'Noch keine Fahrten gespeichert'
      : (trips.length === 1 ? '1 Fahrt' : fmt0.format(trips.length) + ' Fahrten') +
        ' · ' + (km >= 100 ? fmt0.format(km) : fmt1.format(km)) + ' km im Archiv';
  }

  function renderTripsList(trips) {
    const list = $('tripsList');
    const empty = $('tripsEmpty');
    list.innerHTML = '';
    list.hidden = trips.length === 0;
    empty.hidden = trips.length > 0;
    if (!trips.length) return;

    const frag = document.createDocumentFragment();
    for (const t of trips) {
      const row = document.createElement('div');
      row.className = 'trip-row';
      if (state.trip && state.trip.id === t.id) row.classList.add('current');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.title = t.name + ' · ' + formatDate(t.date);
      row.dataset.id = t.id;

      const kmText = (t.km >= 100 ? fmt0.format(t.km) : fmt1.format(t.km)) + ' km';
      const consText = (t.estimatedCons ? '≈ ' : '') + fmt1.format(t.avgCons) + ' L/100';
      row.setAttribute('aria-label', t.name + ', ' + formatDate(t.date) + ', ' + kmText + ', ' + consText + ' – öffnen');

      const main = document.createElement('div');
      main.className = 'trip-row-main';

      const name = document.createElement('span');
      name.className = 'trip-row-name';
      name.textContent = t.name;

      const sub = document.createElement('span');
      sub.className = 'trip-row-sub';
      const chip = document.createElement('span');
      chip.className = 'trip-chip';
      chip.textContent = t.source === 'gps' ? 'GPS' : t.source === 'import' ? 'Import' : 'Fahrt';
      const date = document.createElement('span');
      date.textContent = formatDate(t.date);
      sub.append(chip, date);
      main.append(name, sub);

      const metrics = document.createElement('div');
      metrics.className = 'trip-row-metrics';
      const km = document.createElement('span');
      km.className = 'trip-row-km';
      km.textContent = kmText;
      const cons = document.createElement('span');
      cons.className = 'trip-row-cons';
      cons.textContent = consText;
      cons.style.color = colorFor(t.avgCons || 0);
      metrics.append(km, cons);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'trip-del';
      del.title = 'Fahrt löschen';
      del.setAttribute('aria-label', 'Fahrt „' + t.name + '“ löschen');
      del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M10 4h4M9.5 7v11M14.5 7v11M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTrip(t);
      });

      row.addEventListener('click', () => loadTrip(t.id));
      row.addEventListener('keydown', (e) => {
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          loadTrip(t.id);
        }
      });

      row.append(main, metrics, del);
      frag.appendChild(row);
    }
    list.appendChild(frag);
  }

  async function saveTrip(trip) {
    if (!window.TripStore) return null;
    try {
      const summary = await TripStore.save(trip);
      await refreshTrips();
      return summary;
    } catch (err) {
      toast('Fahrt konnte nicht gespeichert werden.', true);
      return null;
    }
  }

  async function loadTrip(id) {
    if (!window.TripStore) return;
    try {
      const trip = await TripStore.get(id);
      if (!trip) {
        toast('Fahrt ist nicht mehr vorhanden.', true);
        refreshTrips();
        return;
      }
      startTrip(trip, true);
      closeTrips();
      toast('„' + trip.name + '“ geladen · ' + fmt1.format(trip.stats.totalDist / 1000) + ' km');
    } catch (err) {
      toast('Fahrt konnte nicht geladen werden.', true);
    }
  }

  async function deleteTrip(t) {
    const ok = window.confirm('Fahrt „' + t.name + '“ vom ' + formatDate(t.date) + ' löschen?');
    if (!ok) return;
    try {
      await TripStore.remove(t.id);
      if (state.trip && state.trip.id === t.id) state.trip.id = null;
      await refreshTrips();
      toast('Fahrt gelöscht');
    } catch (err) {
      toast('Löschen fehlgeschlagen.', true);
    }
  }

  function openTrips(e) {
    if (e && e.currentTarget && e.currentTarget.focus) tripsOpener = e.currentTarget;
    clearTimeout(drawerTimer);
    tripsDrawer.hidden = false;
    void tripsDrawer.offsetWidth;
    tripsDrawer.classList.add('open');
    document.body.classList.add('page-open');
    if (appRoot) appRoot.inert = true;
    refreshTrips();
    $('tripsClose').focus({ preventScroll: true });
  }

  function closeTrips() {
    if (tripsDrawer.hidden) return;
    tripsDrawer.classList.remove('open');
    document.body.classList.remove('page-open');
    if (appRoot) appRoot.inert = false;
    clearTimeout(drawerTimer);
    drawerTimer = setTimeout(() => {
      if (tripsDrawer.classList.contains('open')) return;
      tripsDrawer.hidden = true;
    }, 240);
    const back = tripsOpener && tripsOpener.getClientRects().length ? tripsOpener : $('btnTrips');
    back.focus({ preventScroll: true });
  }

  /* ---------------- Daten / UI ---------------- */

  function startTrip(trip, fit) {
    if (rec.active) stopRecording(false);
    state.recording = false;
    stopPlay(false);
    state.trip = trip;
    state.hover = -1;
    state.selected = -1;
    state.playIdx = 0;
    layerPts = null;
    if (hoverMarker) { hoverMarker.remove(); hoverMarker = null; }
    if (selectedMarker) { selectedMarker.remove(); selectedMarker = null; }
    if (carMarker) { carMarker.remove(); carMarker = null; }

    $('tripName').textContent = trip.name;
    $('tripDate').textContent = (trip.meta.source === 'simulation' ? 'Simuliert · ' : '') + formatDate(trip.meta.date);

    $('statDist').textContent = fmt1.format(trip.stats.totalDist / 1000);
    $('statTime').textContent = trip.stats.duration < 3600
      ? Math.max(1, Math.round(trip.stats.duration / 60)) + ' min'
      : formatDuration(trip.stats.duration);
    $('statAvg').textContent = fmt1.format(trip.stats.avgCons);
    $('statAvg').style.color = colorFor(trip.stats.avgCons || 0);
    $('statMax').textContent = fmt1.format(trip.stats.maxCons);
    $('statSpeed').textContent = fmt0.format(trip.stats.avgSpeed);
    $('statFuel').textContent = (trip.meta.estimatedCons ? '≈ ' : '') +
      fmt1.format(trip.stats.fuel) + ' L verbraucht';

    const badge = $('sourceBadge');
    let label = trip.meta.label || (trip.meta.source === 'simulation' ? 'Simulation' : 'Import');
    if (trip.meta.source !== 'simulation' && trip.meta.estimatedCons) label += ' · Verbrauch geschätzt';
    badge.textContent = label;
    badge.classList.toggle('import', trip.meta.source !== 'simulation');

    $('timeTotal').textContent = formatClock(trip.points[trip.points.length - 1].time);
    $('timeCurrent').textContent = '0:00';
    const scrub = $('scrub');
    scrub.value = 0;
    scrub.style.setProperty('--p', '0%');

    detailCard.hidden = true;
    detailClose.hidden = true;
    detailCard.classList.remove('locked');
    $('mapHint').classList.remove('gone');

    renderPhaseLegend();
    renderRoute();
    renderChartStatic();
    drawChart();

    if (fit) {
      const bounds = L.latLngBounds(trip.points.map((p) => [p.lat, p.lng]));
      const narrow = map.getSize().x < 620;
      const pad = narrow
        ? { paddingTopLeft: [28, 44], paddingBottomRight: [28, 92] }
        : { padding: [42, 42] };
      map.fitBounds(bounds, Object.assign(pad, { maxZoom: 13.5, animate: false }));
      layerPts = null;
    }
  }

  function renderPhaseLegend() {
    const wrap = $('phaseLegend');
    const order = [];
    for (const p of state.trip.points) {
      if (p.phase && !order.includes(p.phase)) order.push(p.phase);
    }
    if (!order.length) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    wrap.innerHTML = order.map((name) => {
      const c = PHASE[name] ? PHASE[name].dot : '#8194a8';
      return '<span><i style="--c:' + c + '"></i>' + name + '</span>';
    }).join('');
  }

  function bindUI() {
    $('btnPlay').addEventListener('click', togglePlay);
    $('scrub').addEventListener('input', onScrub);
    $('follow').addEventListener('change', (e) => { state.follow = e.target.checked; });
    detailClose.addEventListener('click', clearSelection);

    $('btnRecord').addEventListener('click', toggleRecording);
    $('btnStopRec').addEventListener('click', () => stopRecording(true));
    $('btnDiscardRec').addEventListener('click', () => stopRecording(false));

    $('btnTrips').addEventListener('click', openTrips);
    $('btnTripsRail').addEventListener('click', openTrips);
    $('tripsClose').addEventListener('click', closeTrips);

    $('btnShuffle').addEventListener('click', () => {
      startTrip(TripSim.buildSimulation(Date.now()), true);
      toast('Neue Fahrt simuliert – ' + fmt1.format(state.trip.stats.totalDist / 1000) + ' km');
    });

    $('btnExport').addEventListener('click', exportJSON);

    $('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const trip = await TripData.loadFile(file);
        startTrip(trip, true);
        const saved = await saveTrip(trip);
        toast('„' + file.name + '“ geladen · ' + fmt1.format(trip.stats.totalDist / 1000) + ' km' +
          (trip.meta.estimatedCons ? ' · Verbrauch geschätzt' : '') +
          (saved ? ' · gespeichert' : ''));
      } catch (err) {
        toast(err.message || 'Datei konnte nicht gelesen werden.', true);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!tripsDrawer.hidden) {
          closeTrips();
          return;
        }
        clearSelection();
        return;
      }
      if (!tripsDrawer.hidden) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    });
  }

  function setupPWA() {
    // In der Android-App liegen alle Dateien lokal, ein Service Worker ist dort überflüssig.
    if (!window.__native && 'serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }

    let deferred = null;
    const btn = $('btnInstall');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      if (btn) btn.hidden = false;
    });
    if (btn) {
      btn.addEventListener('click', async () => {
        if (!deferred) return;
        deferred.prompt();
        const res = await deferred.userChoice;
        deferred = null;
        btn.hidden = true;
        toast(res.outcome === 'accepted' ? 'App wird installiert' : 'Installation abgebrochen');
      });
    }
    window.addEventListener('appinstalled', () => {
      if (btn) btn.hidden = true;
      toast('Fahrtprofil ist installiert');
    });
  }

  function exportJSON() {
    if (!state.trip) return;
    const trip = state.trip;
    const data = {
      name: trip.name,
      date: trip.meta.date,
      source: trip.meta.source,
      points: trip.points.map((p) => ({
        lat: Number(p.lat.toFixed(6)),
        lng: Number(p.lng.toFixed(6)),
        ele: Math.round(p.ele * 10) / 10,
        speed: Math.round(p.speed * 10) / 10,
        cons: Math.round(p.cons * 100) / 100,
        dist: Math.round(p.dist),
        time: Math.round(p.time * 10) / 10,
        phase: p.phase || undefined
      }))
    };
    const fileName = 'fahrtprofil-' + new Date().toISOString().slice(0, 10) + '.json';
    const text = JSON.stringify(data, null, 2);

    // In der Android-App öffnet sich das Teilen-Menü (Download per Blob geht im WebView nicht).
    if (window.AndroidBridge && typeof AndroidBridge.shareFile === 'function') {
      AndroidBridge.shareFile(fileName, 'application/json', text);
      return;
    }

    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Fahrt als JSON exportiert');
  }

  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  function formatClock(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h + ':' + String(m).padStart(2, '0');
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    let h = Math.floor(s / 3600);
    let m = Math.round((s % 3600) / 60);
    if (m === 60) { h++; m = 0; }
    return h + ':' + String(m).padStart(2, '0') + ' h';
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unbekanntes Datum';
    return dateFmt.format(d);
  }
})();
