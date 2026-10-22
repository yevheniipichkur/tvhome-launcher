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
  // Each clock character is a slot; a changed digit rolls up out of view and the new one rolls in.
  var clockShown = '';
  function setClock(text) {
    var box = $('clock');
    if (box.children.length !== text.length) {
      box.innerHTML = '';
      for (var i = 0; i < text.length; i++) {
        var slot = document.createElement('span');
        slot.className = 'slot' + (text[i] === ':' ? ' colon' : '');
        slot.innerHTML = '<span class="d cur"></span>';
        slot.firstChild.textContent = text[i];
        box.appendChild(slot);
      }
      clockShown = text;
      return;
    }
    for (var j = 0; j < text.length; j++) {
      if (text[j] === clockShown[j]) continue;
      var sl = box.children[j];
      var old = sl.querySelector('.cur');
      var nu = document.createElement('span');
      nu.className = 'd in';
      nu.textContent = text[j];
      sl.appendChild(nu);
      if (old) { old.className = 'd out'; setTimeout((function (o) { return function () { if (o.parentNode) o.parentNode.removeChild(o); }; })(old), 700); }
      requestAnimationFrame((function (n) { return function () { requestAnimationFrame(function () { n.className = 'd cur'; }); }; })(nu));
    }
    clockShown = text;
  }
  function tickClock() {
    var now = new Date();
    setClock(hhmm(now));
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
  var painted = false;

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
      // intro: raions fade in sweeping west → east
      var x0 = parseFloat(r.d.slice(1));
      e.style.animationDelay = (300 + x0 * 1.6).toFixed(0) + 'ms';
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
    el('circle', { cx: p[0], cy: p[1], r: 6, 'class': 'ping' }, home);
    el('circle', { cx: p[0], cy: p[1], r: 6, 'class': 'ping late' }, home);
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
      var fresh = lv && !r.lv && painted ? ' flash' : '';
      r.lv = lv;
      r.el.setAttribute('class', 'raion' + (lv ? ' ' + lv : '') + fresh);
    });
    painted = true;
    var kyiv = ob['м. Київ'] || ra['м. Київ|м. Київ'] || ra['м. Київ|Київ'];
    if (oblastEls['м. Київ']) oblastEls['м. Київ'].setAttribute('class', 'raion city' + (kyiv ? ' ' + kyiv : ''));
    var sev = ob['Севастополь'] || ob['Автономна Республіка Крим'];
    if (oblastEls['Севастополь']) oblastEls['Севастополь'].setAttribute('class', 'raion city' + (sev ? ' ' + sev : ''));
  }

  // Targets are kept by id, so a moving Shahed glides to its new spot instead of blinking.
  var threatEls = {};
  function paintThreats() {
    var seen = {};
    (data.threats || []).forEach(function (t) {
      seen[t.id] = true;
      var p = proj(t.lon, t.lat);
      var rot = t.heading == null ? 0 : t.heading;
      var item = threatEls[t.id];
      if (!item) {
        var g = el('g', { 'class': 't ' + t.kind + ' enter' }, threatLayer);
        var inner = el('g', { 'class': 'rot' }, g);
        el('path', { d: t.kind === 'missile' ? MISSILE : SHAHED }, inner);
        var label = el('text', { x: 12, y: -10 }, g);
        item = threatEls[t.id] = { g: g, inner: inner, label: label, rot: rot };
        g.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)';
        inner.style.transform = 'rotate(' + rot + 'deg) scale(1.15)';
        requestAnimationFrame(function () { requestAnimationFrame(function () { g.classList.remove('enter'); }); });
      }
      // shortest way round when the heading changes
      var d = ((rot - item.rot) % 360 + 540) % 360 - 180;
      item.rot += d;
      item.g.setAttribute('class', 't ' + t.kind + (t.stale ? ' stale' : ''));
      item.g.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)';
      item.inner.style.transform = 'rotate(' + item.rot + 'deg) scale(1.15)';
      item.label.textContent = t.count > 1 ? '×' + t.count : '';
    });
    Object.keys(threatEls).forEach(function (id) {
      if (seen[id]) return;
      var g = threatEls[id].g;
      delete threatEls[id];
      g.classList.add('leave');
      setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 800);
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

  // Numbers glide to their new value instead of jumping.
  function countTo(id, target) {
    var e = $(id);
    var from = Number(e.getAttribute('data-v') || 0);
    e.setAttribute('data-v', target);
    if (from === target) { e.textContent = target; return; }
    var t0 = performance.now(), dur = 900;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      k = 1 - Math.pow(1 - k, 3);
      e.textContent = Math.round(from + (target - from) * k);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
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
    var fc = data.forecast;
    if (fc) {
      var t = fc.label + ' ' + fc.max + '°/' + fc.min + '°';
      if (fc.precip) t += ' · ' + fc.precip.kind + ' з ' + pad(fc.precip.from) + ':00 до ' + pad(fc.precip.to % 24) + ':00 · ' + fc.advice;
      else t += ' · ' + fc.text + ' · ' + fc.advice;
      $('fc-text').textContent = t;
      $('fc-dot').className = 'dot ' + (fc.precip ? 'blue' : 'amber');
    }
    var pi = data.pi;
    if (pi && pi.cpu != null) {
      var bits = ['CPU ' + Math.round(pi.cpu) + '°'];
      if (pi.disk != null) bits.push('SSD ' + Math.round(pi.disk) + '°');
      if (pi.ram != null) bits.push('RAM ' + pi.ram + '%');
      if (pi.uptimeSec != null) {
        var days = Math.floor(pi.uptimeSec / 86400), hrs = Math.floor(pi.uptimeSec / 3600);
        bits.push('аптайм ' + (days >= 1 ? days + ' д' : hrs + ' год'));
      }
      $('pi-text').textContent = bits.join(' · ');
      // SSD overheating is what used to freeze the Pi; CPU throttles at 80–85°.
      var level = (pi.disk >= 75 || pi.cpu >= 80) ? 'hot' : (pi.disk >= 65 || pi.cpu >= 72) ? 'warn' : '';
      $('pi-dot').className = 'dot ' + level;
    } else {
      $('pi-text').textContent = 'pi: немає даних';
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
    countTo('sky-n', n);
    $('sky-word').textContent = plural(n, 'ціль', 'цілі', 'цілей');
    countTo('sky-t', data.today);
    countTo('sky-now-n', n);
    $('sky-now-word').textContent = plural(n, 'ціль', 'цілі', 'цілей');
    countTo('sky-today', data.today);
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
      if (!err) { data = d; paint(); paintBackground(); }
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
    var host = $('dock');
    host.innerHTML = '';
    var dock = document.createElement('div');
    dock.className = 'track';
    dock.id = 'track';
    host.appendChild(dock);
    var glint = $('glint') || document.createElement('div');
    glint.id = 'glint';
    host.parentNode.insertBefore(glint, host.nextSibling);
    var fav = CFG.favorites || [];
    var byPkg = {};
    apps.forEach(function (a) { byPkg[a.pkg] = a; });
    var cont = continueTile(byPkg);
    if (cont) dock.appendChild(cont);
    fav.forEach(function (p) { if (byPkg[p]) dock.appendChild(tile(byPkg[p])); });
    var more = document.createElement('button');
    more.className = 'tile more';
    more.setAttribute('data-action', 'apps');
    more.setAttribute('aria-label', 'Усі програми');
    more.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>';
    dock.appendChild(more);
  }
  // «Продовжити»: the newest Android TV "Play Next" item, Lampa first.
  function continueTile(byPkg) {
    var list = [];
    if (TV && TV.watchNext) { try { list = JSON.parse(TV.watchNext()); } catch (e) { list = []; } }
    else if (/[?&]demo/.test(location.search)) {
      list = [{ pkg: 'top.rootu.lampa', title: 'Тед Лассо', episode: 'Шахи', season: '3', number: '4', position: 1560000, duration: 2700000, art: null, intent: 'x' }];
    }
    if (!list.length) return null;
    var lampa = list.filter(function (x) { return x.pkg === 'top.rootu.lampa'; });
    var w = (lampa.length ? lampa : list)[0];
    var b = document.createElement('button');
    b.className = 'tile cont';
    b.setAttribute('data-intent', w.intent);
    b.setAttribute('aria-label', 'Продовжити: ' + w.title);
    if (w.art) b.style.backgroundImage = 'url(' + w.art + ')';
    var ep = w.season && w.number ? 'S' + w.season + ' · E' + w.number + (w.episode ? ' · ' + w.episode : '') : (w.episode || '');
    var pct = w.duration ? Math.min(100, Math.round(w.position / w.duration * 100)) : 0;
    var app = byPkg[w.pkg] ? byPkg[w.pkg].label : '';
    b.innerHTML = '<span class="cont-shade"></span><span class="cont-tag">▶ Продовжити' + (app ? ' · ' + app : '') + '</span>' +
      '<span class="cont-title"></span><span class="cont-ep"></span>' +
      (pct ? '<span class="cont-bar"><i style="width:' + pct + '%"></i></span>' : '');
    b.querySelector('.cont-title').textContent = w.title;
    b.querySelector('.cont-ep').textContent = ep;
    return b;
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
    if (z === 'dock') return $('track') ? $('track').children : [];
    if (z === 'corner') return document.querySelectorAll('.corner .round');
    return $('grid').children;
  }
  // The dock scrolls so the focused tile stays in view; the glint follows it.
  var trackX = 0;
  function moveGlint(f) {
    var g = $('glint');
    var track = $('track');
    if (zone === 'dock' && f && track) {
      var view = $('dock').clientWidth - 120;
      var left = f.offsetLeft, right = left + f.offsetWidth;
      if (left + trackX < 30) trackX = 30 - left;
      if (right + trackX > view) trackX = view - right;
      trackX = Math.min(0, trackX);
      track.style.transform = 'translateX(' + trackX + 'px)';
    }
    if (!g) return;
    if (zone !== 'dock' || !f) { g.style.opacity = '0'; return; }
    g.style.opacity = '1';
    g.style.transform = 'translateX(' + (f.offsetLeft + trackX + 40 + f.offsetWidth / 2 - 170) + 'px)';
  }
  function render() {
    var all = document.querySelectorAll('.focus');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('focus');
    var list = items(zone);
    if (!list.length) return;
    idx[zone] = Math.max(0, Math.min(idx[zone], list.length - 1));
    var f = list[idx[zone]];
    f.classList.add('focus');
    moveGlint(f);
    if (zone === 'grid' && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
  }
  function openDrawer() {
    loadApps(); buildGrid();
    $('drawer').hidden = false;
    var kids = $('grid').children;
    for (var i = 0; i < kids.length; i++) kids[i].style.animationDelay = Math.min(i * 35, 600) + 'ms';
    zone = 'grid'; idx.grid = 0; render();
  }
  function closeDrawer() { $('drawer').hidden = true; zone = 'dock'; render(); }
  function activate(elm) {
    if (!elm) return;
    var intent = elm.getAttribute('data-intent');
    if (intent) { if (TV && TV.openIntent) TV.openIntent(intent); return; }
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
    var t = e.target.closest ? e.target.closest('[data-pkg],[data-action],[data-intent]') : null;
    if (t) activate(t);
  });

  // ---------- time-of-day background ----------
  // Palettes stay dark so text and the map keep their contrast.
  var PHASES = {
    night:  { bg: 'radial-gradient(140% 90% at 70% -10%, #23305a 0%, transparent 60%), linear-gradient(180deg, #121830 0%, #161a28 55%, #17181d 100%)', g1: 'rgba(90,110,210,.20)', g2: 'rgba(160,90,200,.10)', stars: true },
    dawn:   { bg: 'radial-gradient(120% 80% at 30% 120%, #9a4e3c 0%, transparent 60%), linear-gradient(180deg, #2a2a48 0%, #4a3346 55%, #6b3d38 100%)', g1: 'rgba(255,150,110,.24)', g2: 'rgba(200,120,180,.14)' },
    day:    { bg: 'radial-gradient(130% 90% at 75% -20%, #3d5670 0%, transparent 60%), linear-gradient(180deg, #2b3644 0%, #2a2f37 55%, #25272b 100%)', g1: 'rgba(150,190,230,.16)', g2: 'rgba(217,119,87,.10)' },
    golden: { bg: 'radial-gradient(120% 80% at 80% 115%, #a0602e 0%, transparent 60%), linear-gradient(180deg, #33302f 0%, #4a3527 55%, #5e3a24 100%)', g1: 'rgba(255,170,90,.24)', g2: 'rgba(217,119,87,.16)' },
    dusk:   { bg: 'radial-gradient(120% 80% at 20% 115%, #7a3348 0%, transparent 60%), linear-gradient(180deg, #1d1d38 0%, #2f2240 55%, #432a3c 100%)', g1: 'rgba(220,110,150,.20)', g2: 'rgba(110,100,210,.14)', stars: true },
  };
  function phaseNow() {
    var w = data && data.weather;
    var now = Date.now();
    if (!w) { var h = new Date().getHours(); return h >= 7 && h < 18 ? 'day' : 'night'; }
    var rise = new Date(w.sunrise[0]).getTime(), set = new Date(w.sunset[0]).getTime(), H = 3600e3;
    if (now < rise - H || now > set + 1.2 * H) return 'night';
    if (now < rise + H) return 'dawn';
    if (now < set - 1.5 * H) return 'day';
    if (now < set) return 'golden';
    return 'dusk';
  }
  var bgPhase = null, bgFront = 'bg-a';
  function paintBackground() {
    var ph = phaseNow();
    document.body.classList.toggle('danger', !!(data && data.alerts && data.alerts.city && data.alerts.city.active));
    if (ph === bgPhase) return;
    var P2 = PHASES[ph];
    var back = bgFront === 'bg-a' ? 'bg-b' : 'bg-a';
    $(back).style.background = P2.bg;
    $(back).classList.add('on');
    $(bgFront).classList.remove('on');
    bgFront = back;
    document.documentElement.style.setProperty('--glow1', P2.g1);
    document.documentElement.style.setProperty('--glow2', P2.g2);
    $('stars').classList.toggle('on', !!P2.stars);
    document.body.setAttribute('data-phase', ph);
    bgPhase = ph;
  }
  (function makeStars() {
    var box = $('stars'), html = '';
    for (var i = 0; i < 46; i++) {
      var x = (i * 137.5) % 100, y = (i * 61.8 * 1.7) % 100, sz = i % 7 === 0 ? 3 : 2;
      html += '<b style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%;width:' + sz + 'px;height:' + sz + 'px;animation-delay:' + (i % 9 * 0.45).toFixed(2) + 's"></b>';
    }
    box.innerHTML = html;
  })();
  paintBackground();
  setInterval(paintBackground, 60000);
  // preview any phase: ?phase=dawn
  var forced = /[?&]phase=(\w+)/.exec(location.search);
  if (forced && PHASES[forced[1]]) { phaseNow = function () { return forced[1]; }; bgPhase = null; paintBackground(); }

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
  // Intro sequence lives in CSS (body.intro); typed welcome line here.
  (function typeWelcome() {
    var t = $('welcome-typed');
    var text = t.getAttribute('data-text');
    var i = 0;
    t.textContent = '';
    var timer = setInterval(function () {
      t.textContent = text.slice(0, ++i);
      if (i >= text.length) clearInterval(timer);
    }, 45);
  })();
  setTimeout(function () { document.body.classList.remove('intro'); }, 4000);
})();
