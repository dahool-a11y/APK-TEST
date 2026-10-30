/* Fahrtprofil – Offline-Vektorkarte
 * Zeichnet die in data/basemap.js gebündelten OSM-Daten (ODbL) direkt
 * in Leaflet-Kacheln. Kein Tile-Server, keine Internetverbindung nötig.
 */
(function () {
  'use strict';

  const DATA = window.BASEMAP;
  if (!DATA) return;

  const ROAD = {
    motorway: { w: 3.0, color: '#4f657c' },
    trunk:    { w: 2.6, color: '#475c71' },
    primary:  { w: 2.2, color: '#3d5063' },
    secondary:{ w: 1.8, color: '#344452' },
    tertiary: { w: 1.4, color: '#2b3946' },
    minor:    { w: 0.8, color: '#24303c' }
  };
  const ROAD_ORDER = ['minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];

  function bbox(coords) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < coords.length; i++) {
      const p = coords[i];
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
  }

  function prepare(list, props) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const g = props ? item.g : item;
      if (!g || g.length < 2) continue;
      out.push({ ...(props ? item : {}), g, b: bbox(g) });
    }
    return out;
  }

  const green = prepare(DATA.green || []);
  const water = prepare(DATA.water || []);
  const rivers = prepare(DATA.rivers || []);
  const rails = prepare(DATA.rails || []);
  const roads = prepare(DATA.roads || [], true).sort(
    (a, b) => ROAD_ORDER.indexOf(a.c) - ROAD_ORDER.indexOf(b.c)
  );

  function intersects(b, minX, minY, maxX, maxY) {
    return !(b[2] < minX || b[0] > maxX || b[3] < minY || b[1] > maxY);
  }

  const BasemapLayer = L.GridLayer.extend({
    options: {
      tileSize: 256,
      updateWhenZooming: false,
      updateWhenIdle: true,
      keepBuffer: 2,
      attribution: 'Karte: &copy; OpenStreetMap-Mitwirkende (ODbL)'
    },

    createTile: function (coords) {
      const size = this.getTileSize();
      const tile = L.DomUtil.create('canvas', 'basemap-tile');
      tile.width = size.x;
      tile.height = size.y;
      const ctx = tile.getContext('2d');

      this._draw(ctx, coords, size);
      return tile;
    },

    _draw: function (ctx, coords, size) {
      const z = coords.z;
      const ox = coords.x * size.x;
      const oy = coords.y * size.y;
      const bounds = this._tileCoordsToBounds(coords);
      const minLng = bounds.getWest(), maxLng = bounds.getEast();
      const minLat = bounds.getSouth(), maxLat = bounds.getNorth();
      const crs = L.CRS.EPSG3857;
      const map = this._map;

      const proj = (lng, lat) => {
        const p = crs.latLngToPoint(L.latLng(lat, lng), z);
        return [p.x - ox, p.y - oy];
      };

      ctx.fillStyle = '#0a1016';
      ctx.fillRect(0, 0, size.x, size.y);

      const f = Math.max(0.6, Math.min(2.2, Math.pow(2, (z - 11) * 0.55)));
      const showMinor = z >= 12.5;

      // Grünflächen
      ctx.fillStyle = 'rgba(47,88,67,0.17)';
      for (let i = 0; i < green.length; i++) {
        const ft = green[i];
        if (!intersects(ft.b, minLng, minLat, maxLng, maxLat)) continue;
        ctx.beginPath();
        let moved = false;
        for (let j = 0; j < ft.g.length; j++) {
          const p = proj(ft.g[j][0], ft.g[j][1]);
          if (!moved) { ctx.moveTo(p[0], p[1]); moved = true; }
          else ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Wasserflächen
      ctx.fillStyle = '#0c1b27';
      ctx.strokeStyle = 'rgba(56,105,145,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < water.length; i++) {
        const ft = water[i];
        if (!intersects(ft.b, minLng, minLat, maxLng, maxLat)) continue;
        ctx.beginPath();
        let moved = false;
        for (let j = 0; j < ft.g.length; j++) {
          const p = proj(ft.g[j][0], ft.g[j][1]);
          if (!moved) { ctx.moveTo(p[0], p[1]); moved = true; }
          else ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Flüsse
      ctx.strokeStyle = '#1a3a52';
      ctx.lineWidth = Math.max(1, 1.2 * f);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < rivers.length; i++) {
        const ft = rivers[i];
        if (!intersects(ft.b, minLng, minLat, maxLng, maxLat)) continue;
        ctx.beginPath();
        for (let j = 0; j < ft.g.length; j++) {
          const p = proj(ft.g[j][0], ft.g[j][1]);
          if (j === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
      }

      // Bahnstrecken
      ctx.strokeStyle = 'rgba(85,105,125,0.55)';
      ctx.lineWidth = Math.max(0.8, 1.1 * f);
      ctx.setLineDash([3 * f, 3 * f]);
      for (let i = 0; i < rails.length; i++) {
        const ft = rails[i];
        if (!intersects(ft.b, minLng, minLat, maxLng, maxLat)) continue;
        ctx.beginPath();
        for (let j = 0; j < ft.g.length; j++) {
          const p = proj(ft.g[j][0], ft.g[j][1]);
          if (j === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Straßen: erst alle Ränder, dann alle Füllungen
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let r = 0; r < ROAD_ORDER.length; r++) {
        const cls = ROAD_ORDER[r];
        if (cls === 'minor' && !showMinor) continue;
        const st = ROAD[cls];
        ctx.strokeStyle = 'rgba(4,8,13,0.92)';
        ctx.lineWidth = cls === 'minor' ? Math.max(1, st.w * f + 1.2) : Math.max(1.5, st.w * f + 2.2);
        for (let i = 0; i < roads.length; i++) {
          const ft = roads[i];
          if (ft.c !== cls) continue;
          if (!intersects(ft.b, minLng, minLat, maxLng, maxLat)) continue;
          ctx.beginPath();
          for (let j = 0; j < ft.g.length; j++) {
            const p = proj(ft.g[j][0], ft.g[j][1]);
            if (j === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
          }
          ctx.stroke();
        }
      }

      for (let r = 0; r < ROAD_ORDER.length; r++) {
        const cls = ROAD_ORDER[r];
        if (cls === 'minor' && !showMinor) continue;
        const st = ROAD[cls];
        ctx.strokeStyle = st.color;
        ctx.lineWidth = cls === 'minor' ? Math.max(0.7, st.w * f) : Math.max(0.8, st.w * f);
        for (let i = 0; i < roads.length; i++) {
          const ft = roads[i];
          if (ft.c !== cls) continue;
          if (!intersects(ft.b, minLng, minLat, maxLng, maxLat)) continue;
          ctx.beginPath();
          for (let j = 0; j < ft.g.length; j++) {
            const p = proj(ft.g[j][0], ft.g[j][1]);
            if (j === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
          }
          ctx.stroke();
        }
      }
    }
  });

  window.OfflineBasemap = function (options) {
    return new BasemapLayer(options);
  };

  window.addPlaceLabels = function (map, places) {
    const group = L.layerGroup().addTo(map);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rank = { city: 0, town: 1, village: 2 };
    const items = [];

    for (const p of places || []) {
      if (!rank.hasOwnProperty(p.t)) continue;
      const marker = L.marker([p.lat, p.lng], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'place-icon',
          html: '<span class="place-label ' + p.t + '">' + esc(p.n) + '</span>',
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        })
      });
      marker.addTo(group);
      items.push({ p, marker });
    }

    function update() {
      const z = map.getZoom();
      const allowed = {
        city: z >= 8.5,
        town: z >= 10.5,
        village: z >= 12.5
      };
      const size = map.getSize();
      const placed = [];

      for (const it of items) {
        if (!allowed[it.p.t]) it.marker.setOpacity(0);
      }

      const list = items
        .filter((it) => allowed[it.p.t])
        .sort((a, b) => rank[a.p.t] - rank[b.p.t]);

      for (const it of list) {
        const pt = map.latLngToContainerPoint([it.p.lat, it.p.lng]);
        const el = it.marker.getElement();
        let w = 34, h = 12;
        if (el) {
          const label = el.querySelector('.place-label');
          if (label) {
            w = label.offsetWidth || w;
            h = label.offsetHeight || h;
          }
        }
        const box = {
          x1: pt.x - w / 2 - 6,
          y1: pt.y - h / 2 - 3,
          x2: pt.x + w / 2 + 6,
          y2: pt.y + h / 2 + 3
        };
        const onScreen = box.x2 > 0 && box.x1 < size.x && box.y2 > 0 && box.y1 < size.y;
        let overlap = false;
        if (onScreen) {
          for (const q of placed) {
            if (!(box.x2 < q.x1 || box.x1 > q.x2 || box.y2 < q.y1 || box.y1 > q.y2)) {
              overlap = true;
              break;
            }
          }
        }
        if (onScreen && !overlap) {
          placed.push(box);
          it.marker.setOpacity(1);
        } else {
          it.marker.setOpacity(0);
        }
      }
    }

    map.on('moveend zoomend resize', () => requestAnimationFrame(update));
    requestAnimationFrame(update);
    update();
    return group;
  };
})();
