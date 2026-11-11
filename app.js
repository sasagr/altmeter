/* AltMeter — elevation + weather for any place on Earth.
 * Free, key-less data sources:
 *   Elevation : Open-Meteo Elevation API (Copernicus DEM GLO-90)
 *   Weather   : Open-Meteo Forecast API
 *   Search    : Open-Meteo Geocoding API (GeoNames)
 *   Reverse   : Nominatim (OpenStreetMap)
 *   Tiles     : OpenStreetMap, OpenTopoMap, Esri World Imagery
 */
(() => {
  'use strict';

  // ---------- storage helpers (never throw) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- units ----------
  let units = store.get('altmeter.units', 'metric');
  const U = {
    elev: (m) => units === 'metric' ? [Math.round(m).toLocaleString(), 'm'] : [Math.round(m * 3.28084).toLocaleString(), 'ft'],
    temp: (c) => units === 'metric' ? [Math.round(c), '°C'] : [Math.round(c * 9 / 5 + 32), '°F'],
    wind: (k) => units === 'metric' ? `${Math.round(k)} km/h` : `${Math.round(k * 0.621371)} mph`,
    pres: (h) => units === 'metric' ? `${Math.round(h)} hPa` : `${(h * 0.02953).toFixed(2)} inHg`,
    prec: (mm) => units === 'metric' ? `${(+mm).toFixed(1)} mm` : `${(mm / 25.4).toFixed(2)} in`,
    dist: (m) => units === 'metric' ? `±${Math.round(m)} m` : `±${Math.round(m * 3.28084)} ft`,
  };
  const elevStr = (m) => { const [v, u] = U.elev(m); return `${v} ${u}`; };

  // ---------- weather codes (WMO) ----------
  const WMO = {
    0: ['Clear sky', '☀️', '🌙'], 1: ['Mainly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'],
    51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Dense drizzle', '🌧️'],
    56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
    61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
    66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
    71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
    80: ['Rain showers', '🌦️'], 81: ['Rain showers', '🌧️'], 82: ['Violent showers', '⛈️'],
    85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'],
    95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
  };
  const wx = (code, isDay) => {
    const w = WMO[code] || ['—', '🌡️'];
    return { text: w[0], icon: !isDay && w[2] ? w[2] : w[1] };
  };
  const compass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
  const fmtCoord = (lat, lon) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
  const hhmm = (iso) => (iso ? iso.slice(11, 16) : '—');

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([30, 10], 3);
  const layers = {
    'Streets': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
    'Topographic': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, subdomains: 'abc',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    }),
  };
  const baseName = layers[store.get('altmeter.layer', 'Topographic')] ? store.get('altmeter.layer', 'Topographic') : 'Topographic';
  layers[baseName].addTo(map);
  L.control.layers(layers, null, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', (e) => store.set('altmeter.layer', e.name));
  L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(map);

  const pinSvg = '<svg viewBox="0 0 30 40"><path d="M15 0C6.7 0 0 6.6 0 14.8 0 26 15 40 15 40s15-14 15-25.2C30 6.6 23.3 0 15 0Z"/><circle cx="15" cy="15" r="5.5" fill="#fff"/></svg>';
  const pinIcon = (kind) => L.divIcon({ className: `pin-mark ${kind}`, html: pinSvg, iconSize: [30, 40], iconAnchor: [15, 40] });
  const gpsIcon = L.divIcon({ className: '', html: '<div class="gps-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

  let selMarker = null;
  let gpsMarker = null;
  let gpsCircle = null;

  // ---------- data fetching ----------
  const getJSON = async (url, signal) => {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  const fetchElevation = (lat, lon, signal) =>
    getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, signal)
      .then((d) => (Array.isArray(d.elevation) ? d.elevation[0] : null));

  const fetchWeather = (lat, lon, signal) => {
    const current = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day', 'precipitation',
      'weather_code', 'cloud_cover', 'pressure_msl', 'surface_pressure', 'wind_speed_10m', 'wind_direction_10m',
      'wind_gusts_10m', 'dew_point_2m', 'visibility', 'uv_index'].join(',');
    const daily = ['temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset', 'precipitation_probability_max'].join(',');
    return getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=${current}&daily=${daily}&timezone=auto&forecast_days=1`, signal);
  };

  const reverseCache = new Map();
  const fetchPlaceName = async (lat, lon, signal) => {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (reverseCache.has(key)) return reverseCache.get(key);
    const d = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=${encodeURIComponent(navigator.language || 'en')}&lat=${lat}&lon=${lon}`, signal);
    let res = null;
    if (d && d.address) {
      const a = d.address;
      const name = a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality || a.county || d.name || a.state || a.country;
      const sub = [a.state || a.region, a.country].filter((x) => x && x !== name).join(', ');
      res = { name: name || 'Unnamed place', sub };
    }
    reverseCache.set(key, res);
    return res;
  };

  // ---------- selection & rendering ----------
  let current = null;       // { lat, lon, kind, name, sub, gps, elevation, weather, errors }
  let ctrl = null;          // AbortController for in-flight requests
  const panel = $('#panel');
  const body = $('#panelBody');

  function setMarker(loc) {
    if (selMarker) { map.removeLayer(selMarker); selMarker = null; }
    if (loc.kind !== 'gps') {
      selMarker = L.marker([loc.lat, loc.lon], { icon: pinIcon(loc.kind), keyboard: false }).addTo(map);
    }
  }

  async function select(loc, { fly = true, zoom } = {}) {
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    const { signal } = ctrl;

    loc.lon = ((loc.lon + 540) % 360) - 180; // normalise wrapped longitudes
    current = { ...loc, elevation: undefined, weather: undefined, errors: [] };
    setMarker(loc);
    const mobile = window.matchMedia('(max-width: 759px)').matches;
    if (mobile) panel.classList.add('collapsed');
    if (fly) {
      const z = zoom ?? Math.max(map.getZoom(), 11);
      let target = L.latLng(loc.lat, loc.lon);
      // on phones keep the pin visible above the bottom sheet
      if (mobile) target = map.unproject(map.project(target, z).add([0, 130]), z);
      map.flyTo(target, z, { duration: 0.8 });
    }
    try { history.replaceState(null, '', `#${loc.lat.toFixed(5)},${loc.lon.toFixed(5)}`); } catch { /* ignore */ }
    panel.classList.remove('empty');
    render();

    const tasks = [
      fetchElevation(loc.lat, loc.lon, signal)
        .then((e) => { if (current.lat === loc.lat) current.elevation = e; })
        .catch((e) => { if (!signal.aborted) { current.elevation = null; current.errors.push('Elevation unavailable'); } }),
      fetchWeather(loc.lat, loc.lon, signal)
        .then((w) => { if (current.lat === loc.lat) current.weather = w; })
        .catch(() => { if (!signal.aborted) { current.weather = null; current.errors.push('Weather unavailable'); } }),
    ];
    if (!loc.name) {
      tasks.push(fetchPlaceName(loc.lat, loc.lon, signal)
        .then((p) => { if (current.lat === loc.lat) { current.name = p ? p.name : (loc.kind === 'gps' ? 'My position' : 'Dropped pin'); current.sub = p ? p.sub : ''; } })
        .catch(() => { if (!signal.aborted) current.name = loc.kind === 'gps' ? 'My position' : 'Dropped pin'; }));
    }
    tasks.forEach((t) => t.then(() => { if (!signal.aborted) render(); }));
    await Promise.allSettled(tasks);
  }

  const sk = '<span class="skeleton"></span>';
  const savedIcon = '<svg viewBox="0 0 24 24"><path d="M6 2h12a1 1 0 0 1 1 1v19l-7-4-7 4V3a1 1 0 0 1 1-1Z"/></svg>';

  function render() {
    const c = current;
    if (!c) return;
    const kindLabel = { gps: 'My position', city: 'City', pin: 'Dropped pin' }[c.kind];
    const isSaved = saved.some((s) => sameSpot(s, c));
    const title = c.name ?? '<span class="skeleton" style="width:9em"></span>';

    // elevation hero
    let elevV = sk, elevN = 'Ground elevation (DEM)';
    if (c.elevation === null) elevV = '—';
    else if (c.elevation !== undefined) {
      const [v, u] = U.elev(c.elevation);
      elevV = `${v}<small>${u}</small>`;
      elevN = c.elevation <= 0 ? (c.elevation < 0 ? 'Below sea level' : 'At sea level') : 'Above sea level';
    }

    // weather hero
    const w = c.weather;
    const cur = w && w.current;
    let tempV = sk, tempN = '&nbsp;';
    if (w === null) tempV = '—';
    else if (cur) {
      const [t, tu] = U.temp(cur.temperature_2m);
      const d = wx(cur.weather_code, cur.is_day);
      tempV = `<span class="wx-ico">${d.icon}</span>${t}<small>${tu}</small>`;
      tempN = esc(d.text);
    }

    let gpsBlock = '';
    if (c.kind === 'gps' && c.gps) {
      const g = c.gps;
      const alt = g.altitude != null
        ? `${elevStr(g.altitude)}${g.altitudeAccuracy != null ? ` <span style="color:var(--muted);font-weight:400">${U.dist(g.altitudeAccuracy)}</span>` : ''}`
        : '<span style="color:var(--muted);font-weight:400">Not reported by this device</span>';
      gpsBlock = `
        <h3>GPS reading</h3>
        <div class="grid">
          <div class="cell"><div class="k">GPS altitude</div><div class="v">${alt}</div></div>
          <div class="cell"><div class="k">Horizontal accuracy</div><div class="v">${g.accuracy != null ? U.dist(g.accuracy) : '—'}</div></div>
        </div>`;
    }

    let wxBlock = '';
    if (cur) {
      const dly = w.daily || {};
      const hi = dly.temperature_2m_max?.[0], lo = dly.temperature_2m_min?.[0];
      const pp = dly.precipitation_probability_max?.[0];
      const cells = [
        ['Feels like', U.temp(cur.apparent_temperature).join('')],
        ['Today high / low', hi != null ? `${U.temp(hi).join('')} / ${U.temp(lo).join('')}` : '—'],
        ['Humidity', `${Math.round(cur.relative_humidity_2m)}%`],
        ['Dew point', U.temp(cur.dew_point_2m).join('')],
        ['Wind', `${U.wind(cur.wind_speed_10m)} ${compass(cur.wind_direction_10m)}`],
        ['Gusts', U.wind(cur.wind_gusts_10m)],
        ['Pressure (sea level)', U.pres(cur.pressure_msl)],
        ['Pressure (surface)', U.pres(cur.surface_pressure)],
        ['Cloud cover', `${Math.round(cur.cloud_cover)}%`],
        ['Precipitation', `${U.prec(cur.precipitation)}${pp != null ? ` · ${pp}% chance today` : ''}`],
        ['UV index', cur.uv_index != null ? (+cur.uv_index).toFixed(1) : '—'],
        ['Visibility', cur.visibility != null ? (units === 'metric' ? `${(cur.visibility / 1000).toFixed(1)} km` : `${(cur.visibility / 1609.34).toFixed(1)} mi`) : '—'],
        ['Sunrise', hhmm(dly.sunrise?.[0])],
        ['Sunset', hhmm(dly.sunset?.[0])],
      ];
      wxBlock = `
        <h3>Weather now · local time ${esc(hhmm(cur.time))} ${esc(w.timezone_abbreviation || '')}</h3>
        <div class="grid">${cells.map(([k, v]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>`;
    }

    body.innerHTML = `
      <div class="place-head">
        <div class="place-title">
          <span class="badge ${c.kind}">${kindLabel}</span>
          <h1>${c.name != null ? esc(c.name) : title}</h1>
          ${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ''}
        </div>
        <button class="save-btn ${isSaved ? 'on' : ''}" id="saveBtn" aria-pressed="${isSaved}">${savedIcon}${isSaved ? 'Saved' : 'Save'}</button>
      </div>
      <div class="hero">
        <div class="hero-card alt"><div class="k">Altitude</div><div class="v">${elevV}</div><div class="n">${elevN}</div></div>
        <div class="hero-card"><div class="k">Weather</div><div class="v">${tempV}</div><div class="n">${tempN}</div></div>
      </div>
      <div class="details">
        ${gpsBlock}
        ${wxBlock}
        <h3>Location</h3>
        <div class="grid">
          <div class="cell" style="grid-column:1/-1"><div class="k">Coordinates</div><div class="v coords">${fmtCoord(c.lat, c.lon)}</div></div>
        </div>
        ${c.errors.length ? `<div class="err">${c.errors.map(esc).join(' · ')}. Try again in a moment.</div>` : ''}
        <div class="foot">Elevation: <a href="https://open-meteo.com/en/docs/elevation-api" target="_blank" rel="noopener">Copernicus DEM 90 m</a> via Open-Meteo · Weather: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> · Places: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, GeoNames</div>
      </div>`;
    $('#saveBtn').onclick = toggleSave;
  }

  // ---------- GPS ----------
  const locateBtn = $('#locate');
  function locate({ quiet = false, center = true } = {}) {
    if (!('geolocation' in navigator)) { if (!quiet) toast('Geolocation is not supported by this browser.'); return; }
    locateBtn.classList.add('busy');
    navigator.geolocation.getCurrentPosition((pos) => {
      locateBtn.classList.remove('busy');
      locateBtn.classList.add('active');
      const { latitude: lat, longitude: lon, accuracy, altitude, altitudeAccuracy } = pos.coords;
      if (gpsMarker) map.removeLayer(gpsMarker);
      if (gpsCircle) map.removeLayer(gpsCircle);
      gpsCircle = L.circle([lat, lon], { radius: accuracy, color: getComputedStyle(document.documentElement).getPropertyValue('--gps').trim() || '#2563eb', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      gpsMarker = L.marker([lat, lon], { icon: gpsIcon, keyboard: false }).addTo(map)
        .on('click', () => select({ lat, lon, kind: 'gps', gps: { accuracy, altitude, altitudeAccuracy } }, { fly: false }));
      if (center) select({ lat, lon, kind: 'gps', gps: { accuracy, altitude, altitudeAccuracy } }, { zoom: 14 });
    }, (err) => {
      locateBtn.classList.remove('busy');
      if (quiet) return;
      const msg = err.code === 1 ? 'Location permission denied. Enable it in your browser settings.'
        : err.code === 3 ? 'Timed out getting your position. Try again.' : 'Could not get your position.';
      toast(msg);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  locateBtn.addEventListener('click', () => locate());

  // ---------- map click = drop pin ----------
  map.on('click', (e) => {
    closeResults();
    select({ lat: e.latlng.lat, lon: e.latlng.lng, kind: 'pin' }, { fly: false });
  });

  // ---------- search ----------
  const q = $('#q');
  const results = $('#results');
  const clearQ = $('#clearQ');
  let searchTimer = 0, searchCtrl = null, items = [], active = -1;

  function closeResults() { results.hidden = true; q.setAttribute('aria-expanded', 'false'); active = -1; }
  function showResults(html) { results.innerHTML = html; results.hidden = false; q.setAttribute('aria-expanded', 'true'); }

  async function runSearch(text) {
    if (searchCtrl) searchCtrl.abort();
    searchCtrl = new AbortController();
    try {
      const d = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(text)}&count=10&language=${encodeURIComponent((navigator.language || 'en').slice(0, 2))}&format=json`, searchCtrl.signal);
      items = d.results || [];
      active = -1;
      if (!items.length) { showResults('<li class="r-empty">No places found</li>'); return; }
      showResults(items.map((r, i) => {
        const sub = [r.admin1, r.country].filter(Boolean).join(', ');
        const el = r.elevation != null ? elevStr(r.elevation) : '';
        return `<li role="option" data-i="${i}" aria-selected="false"><div><div class="r-name">${esc(r.name)}</div><div class="r-sub">${esc(sub)}</div></div><span class="r-elev">${el}</span></li>`;
      }).join(''));
    } catch (e) {
      if (e.name !== 'AbortError') showResults('<li class="r-empty">Search failed — check your connection</li>');
    }
  }

  function pick(i) {
    const r = items[i];
    if (!r) return;
    closeResults();
    q.value = r.name;
    q.blur();
    select({ lat: r.latitude, lon: r.longitude, kind: 'city', name: r.name, sub: [r.admin1, r.country].filter(Boolean).join(', ') }, { zoom: 12 });
  }

  q.addEventListener('input', () => {
    const t = q.value.trim();
    clearQ.hidden = !q.value;
    clearTimeout(searchTimer);
    if (t.length < 2) { closeResults(); return; }
    searchTimer = setTimeout(() => runSearch(t), 280);
  });
  q.addEventListener('keydown', (e) => {
    const lis = [...results.querySelectorAll('li[data-i]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!lis.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
      lis.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      lis[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (lis.length) pick(active >= 0 ? active : 0);
      else if (q.value.trim().length >= 2) { clearTimeout(searchTimer); runSearch(q.value.trim()); }
    } else if (e.key === 'Escape') { closeResults(); }
  });
  q.addEventListener('focus', () => { if (results.children.length && q.value.trim().length >= 2) { results.hidden = false; } });
  results.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) pick(+li.dataset.i); });
  clearQ.addEventListener('click', () => { q.value = ''; clearQ.hidden = true; closeResults(); q.focus(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) closeResults(); });

  // ---------- saved pins ----------
  let saved = store.get('altmeter.saved', []);
  const sameSpot = (a, b) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
  function toggleSave() {
    const c = current;
    if (!c) return;
    const i = saved.findIndex((s) => sameSpot(s, c));
    if (i >= 0) { saved.splice(i, 1); toast('Removed from saved pins'); }
    else {
      saved.unshift({ lat: c.lat, lon: c.lon, name: c.name || 'Pin', sub: c.sub || '', elevation: c.elevation ?? null, kind: c.kind === 'gps' ? 'pin' : c.kind });
      toast('Saved');
    }
    store.set('altmeter.saved', saved);
    render();
    renderSaved();
  }
  const savedSheet = $('#savedSheet');
  const savedList = $('#savedList');
  function renderSaved() {
    if (!saved.length) { savedList.innerHTML = '<li class="empty">No saved pins yet. Select a place and tap <b>Save</b>.</li>'; return; }
    savedList.innerHTML = saved.map((s, i) => `
      <li>
        <button class="go" data-i="${i}"><b>${esc(s.name)}</b><span>${s.elevation != null ? elevStr(s.elevation) + ' · ' : ''}${esc(s.sub || fmtCoord(s.lat, s.lon))}</span></button>
        <button class="icon-btn" data-del="${i}" aria-label="Delete ${esc(s.name)}">×</button>
      </li>`).join('');
  }
  savedList.addEventListener('click', (e) => {
    const go = e.target.closest('[data-i]');
    const del = e.target.closest('[data-del]');
    if (del) {
      saved.splice(+del.dataset.del, 1); store.set('altmeter.saved', saved); renderSaved(); if (current) render();
    } else if (go) {
      const s = saved[+go.dataset.i];
      savedSheet.hidden = true;
      select({ lat: s.lat, lon: s.lon, kind: s.kind || 'pin', name: s.name, sub: s.sub }, { zoom: 12 });
    }
  });
  $('#saved').addEventListener('click', () => { renderSaved(); savedSheet.hidden = !savedSheet.hidden; });
  $('#closeSaved').addEventListener('click', () => { savedSheet.hidden = true; });

  // ---------- units toggle ----------
  const unitsBtn = $('#units');
  const paintUnits = () => { unitsBtn.textContent = units === 'metric' ? 'm · °C' : 'ft · °F'; };
  unitsBtn.addEventListener('click', () => {
    units = units === 'metric' ? 'imperial' : 'metric';
    store.set('altmeter.units', units);
    paintUnits(); render(); renderSaved();
    if (!results.hidden && items.length) runSearch(q.value.trim());
  });
  paintUnits();

  // ---------- mobile sheet grip ----------
  $('#grip').addEventListener('click', () => panel.classList.toggle('collapsed'));
  let touchY = null;
  $('#grip').addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  $('#grip').addEventListener('touchend', (e) => {
    if (touchY == null) return;
    const dy = e.changedTouches[0].clientY - touchY;
    if (dy > 30) panel.classList.add('collapsed');
    else if (dy < -30) panel.classList.remove('collapsed');
    touchY = null;
  });

  // ---------- toast ----------
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ---------- start ----------
  panel.classList.add('empty');
  const fromHash = () => {
    const m = location.hash.match(/^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) return false;
    if (current && sameSpot(current, { lat: +m[1], lon: +m[2] })) return true;
    select({ lat: +m[1], lon: +m[2], kind: 'pin' }, { zoom: 12 });
    return true;
  };
  window.addEventListener('hashchange', fromHash);
  if (fromHash()) locate({ quiet: true, center: false });
  else locate({ quiet: true });
})();
