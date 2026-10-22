/* TV home screen. Runs inside the TVHome launcher's WebView (window.TV bridge)
   or in a desktop browser for previews (demo tiles). ES2017, no build step. */
(function () {
  'use strict';
  var CFG = window.TV_CONFIG || {};
  var TV = window.TV || null;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- canvas scale ----------
  var stage = $('stage');
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- words ----------
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  var DAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', "п'ятниця", 'субота'];
  var MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var hhmm = function (d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  // ---------- clock + Claude-style status line ----------
  var started = Date.now();
  var SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
  var spinI = 0;
  var data = null;

  function verb() {
    if (data && data.alerts && data.alerts.city && data.alerts.city.active) return 'Слухаю небо…';
    var h = new Date().getHours();
    if (h >= 22 || h < 5) return 'Шукаю сонце…';
    if (h < 9) return 'Варю каву…';
    if (h < 18) return 'Ловлю промені…';
    return 'Запалюю лампу…';
  }
  function elapsed() {
    var s = Math.floor((Date.now() - started) / 1000);
    if (s < 60) return '(' + s + ' с)';
    var m = Math.floor(s / 60);
    if (m < 60) return '(' + m + ' хв ' + (s % 60) + ' с)';
    return '(' + Math.floor(m / 60) + ' год ' + (m % 60) + ' хв)';
  }
  function tickClock() {
    var now = new Date();
    $('clock').textContent = hhmm(now);
    $('date').textContent = DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
    $('elapsed').textContent = elapsed();
    $('verb').textContent = verb();
  }
  setInterval(tickClock, 1000);
  setInterval(function () { $('spinner').textContent = SPIN[spinI++ % SPIN.length]; }, 130);
  tickClock();

  var HINTS = ['← → обрати · ОК — запустити', '↑ — мережа й налаштування', 'остання плитка — усі програми'];
  var hintI = 0;
  setInterval(function () { $('hint').textContent = HINTS[++hintI % HINTS.length]; }, 6000);

  // ---------- map: raion-level alerts + live targets ----------
  var map = $('map');
  var geo = null;
  var P = { LON0: 22.0, LAT1: 52.45, K: 60.0, COS: Math.cos(48.5 * Math.PI / 180) };
  function proj(lon, lat) { return [(lon - P.LON0) * P.K * P.COS, (P.LAT1 - lat) * P.K]; }
  var raionEls = [];
  var oblastEls = {};
  var threatLayer;

  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawMap() {
    map.setAttribute('viewBox', '-4 -4 ' + (geo.width + 8) + ' ' + (geo.height + 8));
    map.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var gr = el('g', { 'class': 'raions' }, map);
    geo.raions.forEach(function (r) {
      var e = el('path', { d: r.d, 'class': 'raion' }, gr);
      raionEls.push({ key: r.key, oblast: r.key.split('|')[0], el: e });
    });
    // Kyiv city and Sevastopol have no raions in the set: draw them as their own areas.
    var go = el('g', { 'class': 'oblasts' }, map);
    geo.oblasts.forEach(function (o) {
      var city = o.name === 'м. Київ' || o.name === 'Севастополь';
      oblastEls[o.name] = el('path', { d: o.d, 'class': city ? 'raion city' : 'oblast' }, city ? gr : go);
    });
    var gl = el('g', { 'class': 'labels' }, map);
    geo.oblasts.forEach(function (o) {
      if (o.name === 'Севастополь') return;
      var t = el('text', { x: o.label[0], y: o.label[1] + (o.name === 'м. Київ' ? -7 : o.name === 'Львівська область' ? 16 : 0) }, gl);
      t.textContent = o.name === 'м. Київ' ? 'м. Київ' : o.short;
    });
    var home = el('g', { 'class': 'home' }, map);
    var p = proj(24.0297, 49.8397);
    el('circle', { cx: p[0], cy: p[1], r: 6, 'class': 'ring' }, home);
    el('circle', { cx: p[0], cy: p[1], r: 2.4, 'class': 'core' }, home);
    threatLayer = el('g', {}, map);
  }

  // Top-view Shahed silhouette (nose up), rotated by heading; missile for rockets.
  var SHAHED = 'M0,-13 L2.2,-8.5 L2.2,-3 L13,6.5 L13,9.5 L2.2,6.8 L1.6,10.5 L4.2,12.5 L-4.2,12.5 L-1.6,10.5 L-2.2,6.8 L-13,9.5 L-13,6.5 L-2.2,-3 L-2.2,-8.5 Z';
  var MISSILE = 'M0,-14 L3,-7 L3,7 L6.5,12 L6.5,14 L-6.5,14 L-6.5,12 L-3,7 L-3,-7 Z';
  var DELTA = SHAHED;

  function paintAlerts() {
    var al = data.alerts || {};
    var ob = al.oblasts || {};
    var ra = al.raions || {};
    raionEls.forEach(function (r) {
      var lv = ra[r.key] || ob[r.oblast];
      r.el.setAttribute('class', 'raion' + (lv ? ' ' + lv : ''));
    });
    var kyiv = ob['м. Київ'] || ra['м. Київ|м. Київ'] || ra['м. Київ|Київ'];
    if (oblastEls['м. Київ']) oblastEls['м. Київ'].setAttribute('class', 'raion city' + (kyiv ? ' ' + kyiv : ''));
    var sev = ob['Севастополь'] || ob['Автономна Республіка Крим'];
    if (oblastEls['Севастополь']) oblastEls['Севастополь'].setAttribute('class', 'raion city' + (sev ? ' ' + sev : ''));
  }

  function paintThreats() {
    while (threatLayer.firstChild) threatLayer.removeChild(threatLayer.firstChild);
    (data.threats || []).forEach(function (t) {
      var p = proj(t.lon, t.lat);
      var g = el('g', { 'class': 't ' + t.kind + (t.stale ? ' stale' : ''), transform: 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')' }, threatLayer);
      var rot = t.heading == null ? 0 : t.heading;
      el('path', { d: t.kind === 'missile' ? MISSILE : SHAHED, transform: 'rotate(' + rot + ') scale(1.15)' }, g);
      if (t.count > 1) { var n = el('text', { x: 12, y: -10 }, g); n.textContent = '×' + t.count; }
    });
  }

  var KIND_LABEL = { uav: 'Шахед / БпЛА', jet: 'Реактивний шахед', missile: 'Ракети', kab: 'КАБ', other: 'Інше' };
  var KIND_ICON = { uav: '#ffffff', jet: '#ffb08a', missile: '#ff6b5e', kab: '#f3d36b', other: '#c8c3b8' };
  function paintLegend() {
    var html = '';
    ['jet', 'uav', 'missile', 'kab', 'other'].forEach(function (k) {
      var n = data.counts && data.counts[k];
      if (!n) return;
      html += '<div class="row"><svg viewBox="-15 -15 30 30"><path d="' + (k === 'missile' ? MISSILE : SHAHED) + '" fill="' + KIND_ICON[k] + '" stroke="#10131a" stroke-width="1.6"/></svg>' + KIND_LABEL[k] + ' ' + n + '</div>';
    });
    $('legend').innerHTML = html;
  }

  // ---------- data ----------
  function paint() {
    if (!data) return;
    var w = data.weather;
    if (w) {
      $('weather').textContent = w.temp + '° · ' + w.text + ' · ' + w.max + '°/' + w.min + '°';
      var now = new Date();
      var rise = new Date(w.sunrise[0]), set = new Date(w.sunset[0]);
      if (now > set) $('sun-text').textContent = 'схід завтра о ' + hhmm(new Date(w.sunrise[1])) + ' · ' + data.city;
      else if (now < rise) $('sun-text').textContent = 'схід о ' + hhmm(rise) + ' · захід о ' + hhmm(set);
      else $('sun-text').textContent = 'сонце до ' + hhmm(set) + ' · схід був о ' + hhmm(rise);
    }
    var a = data.alerts && data.alerts.city;
    var line = $('alert-line');
    if (!data.alerts) {
      line.className = 'line';
      $('alert-text').textContent = 'тривоги: немає даних';
    } else if (a && a.active) {
      line.className = 'line on';
      var since = a.since ? ' · з ' + hhmm(new Date(a.since)) : '';
      $('alert-text').textContent = 'повітряна тривога · ' + data.city + since;
    } else {
      line.className = 'line';
      $('alert-text').textContent = 'тривоги немає · ' + data.city;
    }
    var n = data.inSky || 0;
    $('sky-text').textContent = 'у небі зараз ' + n + ' ' + plural(n, 'ціль', 'цілі', 'цілей') + ' · сьогодні ' + data.today;
    $('sky-now').textContent = n + ' ' + plural(n, 'ціль', 'цілі', 'цілей');
    $('sky-today').textContent = data.today;
    if (geo) { paintAlerts(); paintThreats(); paintLegend(); }
  }

  function getJSON(url, cb) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.timeout = 8000;
    x.onload = function () { if (x.status === 200) { try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb(e); } } else cb(new Error(x.status)); };
    x.onerror = x.ontimeout = function () { cb(new Error('net')); };
    x.send();
  }
  function poll() {
    getJSON('api/state', function (err, d) {
      if (!err) { data = d; paint(); }
    });
  }
  getJSON('ukraine.json', function (err, g) { if (!err) { geo = g; drawMap(); paint(); } });
  poll();
  setInterval(poll, CFG.pollMs || 5000);

  // ---------- apps ----------
  var apps = [];
  function loadApps() {
    var list = [];
    if (TV && TV.apps) { try { list = JSON.parse(TV.apps()); } catch (e) { list = []; } }
    else {
      list = [
        { pkg: 'top.rootu.lampa', label: 'Lampa' }, { pkg: 'com.google.android.youtube.tv', label: 'YouTube' },
        { pkg: 'com.megogo.application', label: 'MEGOGO' }, { pkg: 'com.netflix.ninja', label: 'Netflix' },
        { pkg: 'studio.scillarium.ottnavigator', label: 'OTT Navigator' }, { pkg: 'demo.x', label: 'Kodi' },
      ];
    }
    var hidden = CFG.hidden || [];
    apps = list.filter(function (a) { return hidden.indexOf(a.pkg) < 0 && a.pkg !== 'pl.pichkur.tvhome'; });
  }
  function tile(a) {
    var b = document.createElement('button');
    b.className = 'tile';
    b.setAttribute('data-pkg', a.pkg);
    if (a.banner) { b.className += ' banner'; b.style.backgroundImage = 'url(' + a.banner + ')'; }
    else if (a.icon) { var i = document.createElement('img'); i.className = 'icon'; i.src = a.icon; b.appendChild(i); }
    else { b.className += ' text'; b.appendChild(document.createTextNode(a.label)); }
    var l = document.createElement('span'); l.className = 'label'; l.textContent = a.label; b.appendChild(l);
    b.setAttribute('aria-label', a.label);
    return b;
  }
  function buildDock() {
    var dock = $('dock');
    dock.innerHTML = '';
    var fav = CFG.favorites || [];
    var byPkg = {};
    apps.forEach(function (a) { byPkg[a.pkg] = a; });
    fav.forEach(function (p) { if (byPkg[p]) dock.appendChild(tile(byPkg[p])); });
    var more = document.createElement('button');
    more.className = 'tile more';
    more.setAttribute('data-action', 'apps');
    more.setAttribute('aria-label', 'Усі програми');
    more.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>';
    dock.appendChild(more);
  }
  function buildGrid() {
    var grid = $('grid');
    grid.innerHTML = '';
    apps.slice().sort(function (x, y) { return x.label.localeCompare(y.label, 'uk'); }).forEach(function (a) { grid.appendChild(tile(a)); });
  }

  // ---------- focus / remote ----------
  var zone = 'dock'; // 'dock' | 'corner' | 'grid'
  var idx = { dock: 0, corner: 0, grid: 0 };
  function items(z) {
    if (z === 'dock') return $('dock').children;
    if (z === 'corner') return document.querySelectorAll('.corner .round');
    return $('grid').children;
  }
  function render() {
    var all = document.querySelectorAll('.focus');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('focus');
    var list = items(zone);
    if (!list.length) return;
    idx[zone] = Math.max(0, Math.min(idx[zone], list.length - 1));
    var f = list[idx[zone]];
    f.classList.add('focus');
    if (zone === 'grid' && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
  }
  function openDrawer() {
    loadApps(); buildGrid();
    $('drawer').hidden = false;
    zone = 'grid'; idx.grid = 0; render();
  }
  function closeDrawer() { $('drawer').hidden = true; zone = 'dock'; render(); }
  function activate(elm) {
    if (!elm) return;
    var pkg = elm.getAttribute('data-pkg');
    var action = elm.getAttribute('data-action');
    if (pkg) { if (TV && TV.launch) TV.launch(pkg); return; }
    if (action === 'apps') return openDrawer();
    if (TV && TV.openSettings) TV.openSettings(action);
  }
  var COLS = 6;
  document.addEventListener('keydown', function (e) {
    var k = e.key || '';
    var code = e.keyCode;
    var list = items(zone);
    if (k === 'ArrowRight' || code === 22) idx[zone]++;
    else if (k === 'ArrowLeft' || code === 21) idx[zone]--;
    else if (k === 'ArrowUp' || code === 19) {
      if (zone === 'dock') zone = 'corner';
      else if (zone === 'grid') idx.grid = idx.grid >= COLS ? idx.grid - COLS : idx.grid;
    } else if (k === 'ArrowDown' || code === 20) {
      if (zone === 'corner') zone = 'dock';
      else if (zone === 'grid' && idx.grid + COLS < list.length) idx.grid += COLS;
    } else if (k === 'Enter' || code === 13 || code === 23) {
      activate(list[idx[zone]]);
    } else if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || code === 4 || code === 27) {
      if (zone === 'grid') closeDrawer();
      else { zone = 'dock'; idx.dock = 0; }
    } else return;
    e.preventDefault();
    render();
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-pkg],[data-action]') : null;
    if (t) activate(t);
  });

  // ---------- Wi-Fi ----------
  function paintWifi() {
    var w = null;
    if (TV && TV.wifi) { try { w = JSON.parse(TV.wifi()); } catch (e) { w = null; } }
    else w = { type: 'wifi', ssid: 'Wi‑Fi', level: 3 };
    var btn = document.querySelector('.round.pill');
    var name = $('wifi-name');
    var level = 0;
    if (!w || w.type === 'none') { name.textContent = 'немає мережі'; btn.classList.add('down'); }
    else if (w.type === 'ethernet') { name.textContent = 'Ethernet'; level = 3; btn.classList.remove('down'); }
    else { name.textContent = w.ssid || 'Wi‑Fi'; level = w.level; btn.classList.remove('down'); }
    ['w1', 'w2', 'w3'].forEach(function (c, i) {
      var p = document.querySelector('#wifi-icon .' + c);
      if (p) p.setAttribute('class', c + (level > i ? '' : ' off'));
    });
  }
  paintWifi();
  setInterval(paintWifi, 10000);

  // Called by the launcher when the home screen comes back to the front.
  window.tvResume = function () {
    loadApps(); buildDock();
    if (!$('drawer').hidden) closeDrawer();
    zone = 'dock'; render(); poll(); paintWifi();
  };
  // Called by the launcher with Back while the drawer is open.
  window.tvBack = function () {
    if (!$('drawer').hidden) { closeDrawer(); return true; }
    return false;
  };

  loadApps(); buildDock(); render();
})();
