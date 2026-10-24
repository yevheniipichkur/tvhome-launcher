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
    // innerWidth grows with the 1920px canvas inside a WebView; the layout viewport doesn't.
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = document.documentElement.clientHeight || window.innerHeight;
    var s = Math.min(vw / 1920, vh / 1080);
    // CSS zoom (not a transform): layout happens at the zoomed size and everything rasterises 1:1.
    // A transform or page-scale made the box draw a 3840×2160 surface and shrink it every frame.
    stage.style.transform = 'none';
    stage.style.left = '0'; stage.style.top = '0';
    stage.style.zoom = s;
    var bg = document.querySelector('.sky-bg');
    if (bg) bg.style.zoom = s;
  }
  window.addEventListener('resize', fit);
  fit();
  function diag(tag) {
    try { var x = new XMLHttpRequest(); x.open('GET', 'api/diag?t=' + tag + '&w=' + window.innerWidth + '&h=' + window.innerHeight + '&dpr=' + window.devicePixelRatio + '&cw=' + document.documentElement.clientWidth + '&vv=' + (window.visualViewport ? visualViewport.width + 'x' + visualViewport.height + '@' + visualViewport.scale : '-') + '&tr=' + encodeURIComponent(stage.style.transform)); x.send(); } catch (e) {}
  }
  window.addEventListener('error', function (e) { diag('err-' + encodeURIComponent(String(e.message).slice(0, 120)) + '@' + e.lineno); });


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
  var data = null;

  // Each clock character is a slot; a changed digit rolls up out of view and the new one rolls in.
  var clockShown = '';
  function setClock(text) {
    var box = $('clock');
    // analog / words styles from the screen builder draw their own markup
    if (window.TVC && TVC.clock(text)) { clockShown = ''; return; }
    if (box.getAttribute('data-k')) { box.removeAttribute('data-k'); box.innerHTML = ''; }
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
      // Retire every digit already in the slot (not just the ".cur" one): while the page sleeps behind
      // Netflix/YouTube, rAF never fires, so earlier "in" digits never became "cur" and piled up.
      var olds = Array.prototype.slice.call(sl.children);
      var nu = document.createElement('span');
      nu.textContent = text[j];
      if (document.hidden) {
        olds.forEach(function (o) { sl.removeChild(o); });
        nu.className = 'd cur';
        sl.appendChild(nu);
        continue;
      }
      nu.className = 'd in';
      sl.appendChild(nu);
      olds.forEach(function (o) {
        o.className = 'd out';
        setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 750);
      });
      setTimeout((function (n) { return function () { n.className = 'd cur'; }; })(nu), 30);
    }
    clockShown = text;
  }
  // the home city comes from the launcher settings (DataService → data.cityInfo); Lviv until chosen
  // State holidays and memorable days of Ukraine (Christmas on 25 Dec since 2023, Easter by the
  // Julian computus). Under martial law they are not days off, so the screen never says «вихідний».
  var HOLIDAYS = { '1-1': 'Новий рік', '1-22': 'День Соборності', '2-24': 'роковини повномасштабного вторгнення', '3-8': 'Міжнародний жіночий день',
    '5-1': 'День праці', '5-8': 'День пам’яті та перемоги', '6-28': 'День Конституції', '7-15': 'День Української Державності', '8-23': 'День Прапора',
    '8-24': 'День Незалежності', '10-1': 'День захисників і захисниць', '11-9': 'День писемності та мови', '11-21': 'День Гідності та Свободи',
    '12-6': 'День Збройних Сил', '12-25': 'Різдво Христове' };
  function orthodoxEaster(y) {
    var a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
    var m = Math.floor((d + e + 114) / 31), day = (d + e + 114) % 31 + 1;
    return new Date(y, m - 1, day + 13);
  }
  function holiday(dt) {
    var k = (dt.getMonth() + 1) + '-' + dt.getDate();
    if (HOLIDAYS[k]) return HOLIDAYS[k];
    var e = orthodoxEaster(dt.getFullYear()), diff = Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - e) / 864e5);
    if (diff === 0) return 'Великдень';
    if (diff === 49) return 'Трійця';
    // Holodomor remembrance: the fourth Saturday of November
    if (dt.getMonth() === 10 && dt.getDay() === 6 && dt.getDate() >= 22 && dt.getDate() <= 28) return 'День пам’яті жертв голодоморів';
    return null;
  }
  function seasonOn() { try { return localStorage.getItem('tv-season') !== '0'; } catch (e) { return true; } }
  function seasonNow() {
    var m = /[?&]season=(\w+)/.exec(location.search);
    if (m) return m[1];
    if (!seasonOn()) return '';
    var d = new Date(), md = (d.getMonth() + 1) * 100 + d.getDate();
    if (md >= 1219 || md <= 107) return 'newyear';
    if ([122, 628, 715, 823, 824].indexOf(md) >= 0) return 'ukraine';
    return '';
  }
  function paintSeason() {
    var s2 = seasonNow();
    document.body.classList.toggle('season-newyear', s2 === 'newyear');
    document.body.classList.toggle('season-ukraine', s2 === 'ukraine');
    var dock = $('dock'), g = $('garland');
    if (s2 === 'newyear' && dock && !g) {
      g = document.createElement('div'); g.id = 'garland'; g.className = 'garland';
      var h = '<svg viewBox="0 0 1000 30" preserveAspectRatio="none"><path d="M0 4 Q 25 22 50 4 T 100 4 T 150 4 T 200 4 T 250 4 T 300 4 T 350 4 T 400 4 T 450 4 T 500 4 T 550 4 T 600 4 T 650 4 T 700 4 T 750 4 T 800 4 T 850 4 T 900 4 T 950 4 T 1000 4"/></svg>';
      for (var i = 0; i < 20; i++) h += '<i style="left:' + (2.5 + i * 5) + '%;animation-delay:' + (i % 4 * 0.6) + 's" class="c' + (i % 4) + '"></i>';
      g.innerHTML = h;
      dock.appendChild(g);
    } else if (s2 !== 'newyear' && g) g.parentNode.removeChild(g);
  }
  setInterval(paintSeason, 3600e3);
  function cityInfo() { return (data && data.cityInfo) || { name: 'Львів', loc: 'у Львові', lat: 49.8397, lon: 24.0297, oblast: 'Львівська область', state: '27', district: '90', community: '845' }; }
  function cityName() { return cityInfo().name; }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function greet() {
    var el = $('welcome-typed');
    if (!el || el.getAttribute('data-typing')) return;
    var alarm = document.body.classList.contains('alarm');
    var h = new Date().getHours();
    var text = (alarm ? 'Повітряна тривога' : h >= 5 && h < 11 ? 'Доброго ранку' : h < 17 && h >= 11 ? 'Доброго дня' : h >= 17 && h < 23 ? 'Доброго вечора' : 'Добраніч') + ' · ' + cityName();
    if (el.textContent !== text) el.textContent = text;
    var spark = document.querySelector('.greet .spark');
    if (spark) spark.textContent = alarm ? '⚠ ' : '';
  }
  function tickClock() {
    var now = new Date();
    setClock(hhmm(now));
    var dk = now.toDateString();
    if ($('date').getAttribute('data-k') !== dk) {
      var hd = holiday(now), ht = hd ? null : holiday(new Date(now.getTime() + 864e5));
      $('date').setAttribute('data-k', dk);
      $('date').innerHTML = DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()] +
        (hd ? '<span class="hday"> · ' + hd + '</span>' : ht ? '<span class="hday soon"> · завтра ' + ht + '</span>' : '');
    }
    greet();
  }
  setInterval(tickClock, 1000);
  tickClock();


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

  // label nudges (map units) so names don't collide with each other or the Lviv marker
  var labelEls = {};
  var homeOblastEl = null, homeKey = '';
  function paintHomeOblast() {
    if (!homeOblastEl || !geo) return;
    var name = cityInfo().oblast;
    geo.oblasts.forEach(function (o) { if (o.name === name) homeOblastEl.setAttribute('d', o.base || o.d); });
  }
  var LABEL_OFF = { 'м. Київ': [0, -8], 'Львівська область': [-4, 20], 'Тернопільська область': [4, 14], 'Хмельницька область': [12, -6], 'Київська область': [0, 8], 'Івано-Франківська область': [0, 4] };
  function drawMap() {
    setViewBox(document.body.classList.contains('map-zoomed'));
    map.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // ukrainealarm geometry: districts filled, oblasts outlined; oblasts without districts
    // (м. Київ, Крим) are filled as a whole; alerted communities are drawn on top.
    // base: whole oblasts filled, so cities that are communities (Kharkiv, Dnipro…) and gaps never show as holes
    // country outline: every oblast drawn with a light stroke underneath, so only the outer edge
    // of Ukraine (plus oblast borders) reads against busy backgrounds like the street map
    var gh = el('g', { 'class': 'halo' }, map);
    geo.oblasts.forEach(function (o) { el('path', { d: o.base || o.d }, gh); });
        var gb = el('g', { 'class': 'raions base' }, map);
    geo.oblasts.forEach(function (o) {
      var e = el('path', { d: o.base || o.d, 'class': 'raion' }, gb);
      raionEls.push({ id: 'oblast:' + o.id, oblast: o.id, el: e });
    });
    var gr = el('g', { 'class': 'raions' }, map);
    var hasDistricts = {};
    geo.districts.forEach(function (r) {
      var e = el('path', { d: r.d, 'class': 'raion' }, gr);
      raionEls.push({ id: r.id, oblast: r.oblast, el: e });
      hasDistricts[r.oblast] = true;
    });

    commLayer = el('g', { 'class': 'comms' }, map);
    frontLayer = el('g', { 'class': 'front' }, map);
    paintFront();
    // Ukraine's outline as a clip for the weather image
    var defs = el('defs', {}, map), clip = el('clipPath', { id: 'ua-clip' }, defs);
    geo.oblasts.forEach(function (o) { el('path', { d: o.base || o.d }, clip); });
    wxLayer = el('g', { 'class': 'wxl' }, map);
    paintWxMap();
    var go = el('g', { 'class': 'oblasts' }, map);
    geo.oblasts.forEach(function (o) { oblastEls[o.name] = el('path', { d: o.d, 'class': 'oblast' }, go); });
    homeOblastEl = el('path', { d: '', 'class': 'home-oblast' }, map);
    paintHomeOblast();
    var gl = el('g', { 'class': 'labels' }, map);
    geo.oblasts.forEach(function (o) {
      if (o.name === 'Севастополь') return;
      var off = LABEL_OFF[o.name] || [0, 0];
      var t = el('text', { x: o.label[0] + off[0], y: o.label[1] + off[1] }, gl);
      labelEls[o.name] = t;
      t.textContent = o.name === 'м. Київ' ? 'м. Київ' : o.short;
    });
    // Moving things live in an HTML layer above the static SVG: animating them inside the SVG
    // made the WebView repaint the whole map every frame, which the box GPU can't keep up with.
    threatLayer = $('fly');
    drawHome();
  }
  function drawHome() {
    var ci = cityInfo();
    var p = toScreen(ci.lon, ci.lat);
    var home = document.createElement('div');
    home.className = 'home';
    home.innerHTML = '<i class="ping"></i><i class="ping late"></i><i class="ring"></i><i class="core"></i>';
    home.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)';
    threatLayer.appendChild(home);
  }
  // Map size changed (compact <-> big): recompute the projection box and rebuild the moving layer.
  function relayoutMap() {
    if (!geo) return;
    box = null;
    threatLayer.innerHTML = '';
    threatEls = {};
    badgeEls = {};
    drawHome();
    if (data) { paintThreats(); paintBadges(); }
  }

  // "Харківська · 6": how many targets are over each oblast, as a small badge by its name
  var badgeEls = {};
  function paintBadges() {
    toScreen(24, 49); // make sure the projection box exists
    var per = {};
    (data.threats || []).forEach(function (t) { if (!t.stale && t.region) per[t.region] = (per[t.region] || 0) + t.count; });
    geo.oblasts.forEach(function (o) {
      var n = per[o.name] || (o.name === 'м. Київ' ? 0 : 0);
      var b = badgeEls[o.name];
      if (!n) { if (b) { b.remove(); delete badgeEls[o.name]; } return; }
      if (!b) {
        b = badgeEls[o.name] = document.createElement('span');
        b.className = 'badge';
        var lab = labelEls[o.name], x, y;
        if (lab) {
          var bb = lab.getBBox();
          x = box.ox + (bb.x + bb.width) * box.k + 18;
          y = box.oy + (bb.y + bb.height / 2) * box.k - 11;
        } else {
          x = box.ox + o.label[0] * box.k; y = box.oy + o.label[1] * box.k;
        }
        b.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        threatLayer.appendChild(b);
      }
      if (b.textContent !== String(n)) b.textContent = n;
    });
  }

  // map units → px inside the map box (matches viewBox + preserveAspectRatio meet)
  var box = null, vb = null;
  // Zoom = a smaller viewBox around the home city, not a CSS scale: the SVG is rasterised at screen
  // size either way, so zooming costs one normal repaint instead of a 3× bigger raster.
  var kNormal = 0;
  function setViewBox(zoomed) {
    var x = -1, y = -1, W = geo.width + 2, H = geo.height + 2;
    var cw = map.clientWidth || 1, ch = map.clientHeight || 1;
    if (zoomed) {
      // 1.75× the normal scale; the box matches the map area's own aspect, so nothing is letterboxed.
      // In «Кіно» the map area grows to the whole screen while zoomed (CSS), like the old full-bleed zoom.
      var k = (kNormal || Math.min(cw / W, ch / H)) * 1.75;
      var ci = cityInfo(), c = proj(ci.lon, ci.lat);
      var cinema = document.body.classList.contains('layout-cinema');
      var w = cw / k, h = ch / k;
      x = c[0] - w * (cinema ? 0.48 : 0.42); y = c[1] - h * (cinema ? 0.33 : 0.5);
      W = w; H = h;
    }
    vb = { x: x, y: y, w: W, h: H, zoomed: zoomed };
    map.setAttribute('viewBox', x.toFixed(1) + ' ' + y.toFixed(1) + ' ' + W.toFixed(1) + ' ' + H.toFixed(1));
    box = null;
  }
  function toScreen(lon, lat) {
    if (!box) {
      var w = map.clientWidth, h = map.clientHeight;
      var k = Math.min(w / vb.w, h / vb.h);
      box = { k: k, ox: (w - vb.w * k) / 2 - vb.x * k, oy: (h - vb.h * k) / 2 - vb.y * k };
      if (!vb.zoomed) kNormal = k;
    }
    var q = proj(lon, lat);
    return [box.ox + q[0] * box.k, box.oy + q[1] * box.k];
  }

  // Top-view Shahed silhouette (nose up), rotated by heading; missile for rockets.
  var SHAHED = 'M0,-13 L2.2,-8.5 L2.2,-3 L13,6.5 L13,9.5 L2.2,6.8 L1.6,10.5 L4.2,12.5 L-4.2,12.5 L-1.6,10.5 L-2.2,6.8 L-13,9.5 L-13,6.5 L-2.2,-3 L-2.2,-8.5 Z';
  var MISSILE = 'M0,-14 L3,-7 L3,7 L6.5,12 L6.5,14 L-6.5,14 L-6.5,12 L-3,7 L-3,-7 Z';
  var DELTA = SHAHED;

  var commLayer, commKey = '';
  // ---------- front line (DeepStateMAP) as an alternative map layer ----------
  var frontLayer = null, frontData = null;
  var MAP_LAYERS = ['alerts', 'front', 'weather'];
  var MAP_LAYER_NAME = { alerts: 'тривоги', front: 'лінія фронту (DeepState)', weather: 'погода' };
  function mapLayer() { try { var v = localStorage.getItem('tv-maplayer'); return MAP_LAYERS.indexOf(v) >= 0 ? v : 'alerts'; } catch (e) { return 'alerts'; } }
  function applyMapLayer() {
    var layer = mapLayer(), front = layer === 'front', wx = layer === 'weather';
    document.body.classList.toggle('map-front', front);
    document.body.classList.toggle('map-weather', wx);
    document.body.classList.toggle('map-alt', front || wx);
    var c = document.querySelector('.credit');
    if (c) c.textContent = (front ? 'лінія фронту: DeepStateMAP' : wx ? 'погода: Open-Meteo' : 'тривоги: ukrainealarm.com') + ' · цілі: NEPTUN · neptun.in.ua';
    if (front && !frontData) loadFront();
    else if (front) setTimeout(replayFront, 900);
    if (wx) loadWxMap();
  }

  // ---------- weather layer: precipitation / clouds image + temperatures in the cities ----------
  var wxLayer = null, wxData = null;
  function loadWxMap() {
    getJSON('https://tvhome.pichkur.com/api/public/wxmap', function (err, d) { if (!err && d && d.image) { wxData = d; paintWxMap(); } });
  }
  function paintWxMap() {
    if (!wxLayer || !wxData) return;
    var b = wxData.box, home = cityName();
    var h = '<image href="' + wxData.image + '" x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="' + b[3] + '" preserveAspectRatio="none" clip-path="url(#ua-clip)"/>';
    wxData.cities.forEach(function (c) {
      if (c.t == null) return;
      var t = Math.round(c.t);
      h += '<g class="wxt' + (c.name === home ? ' home' : '') + '" transform="translate(' + c.x + ',' + c.y + ')"><text>' + (t > 0 ? '+' : '') + t + '°</text></g>';
    });
    wxLayer.innerHTML = h;
    var box = $('wx-caption');
    if (box) {
      var d = new Date(wxData.updated);
      box.innerHTML = '<div class="fc-h">Погода зараз · ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + '</div>' +
        '<div class="fc-r"><i class="wr"></i>дощ <i class="ws"></i>сніг <i class="wc"></i>хмари</div>';
    }
  }
  setInterval(function () { if (mapLayer() === 'weather') loadWxMap(); }, 30 * 60000);
  function loadFront() {
    getJSON('https://tvhome.pichkur.com/api/public/frontline?v=4', function (err, d) { if (!err && d && d.occupied) { var first = !frontData; frontData = d; paintFront(); if (first) setTimeout(replayFront, 900); } });
  }
  function paintFront() {
    if (!frontLayer || !frontData) return;
    var h = '<path class="gray" d="' + frontData.gray + '"/><path class="occ" d="' + frontData.occupied + '"/>' +
      (frontData.monthAgo ? '<path class="month" d="' + frontData.monthAgo.occupied + '"/>' : '');
    // changes of the last 24 h: a ring per place (red = enemy advance, green = our gains, amber = correction)
    // newest first, so a place that changed twice keeps its latest ring
    var seen = {}, latest = recentChanges();
    (frontData.changes || []).slice().sort(function (a, b) { return b.t - a.t; }).forEach(function (c) {
      var k = Math.round(c.x / 4) + ':' + Math.round(c.y / 4);
      if (seen[k]) return; seen[k] = 1;
      var day = Math.max(0, Math.min(7, Math.floor((Date.now() - c.t) / 864e5)));
      var recent = latest.indexOf(c) >= 0;
      h += '<g class="chg ' + c.kind + (recent ? ' recent' : ' old') + '" data-day="' + day + '" transform="translate(' + c.x + ',' + c.y + ')"><circle class="halo" r="' + (recent ? 9 : 6) + '"/><circle class="dot" r="' + (recent ? 2.6 : 1.8) + '"/></g>';
    });
    frontLayer.innerHTML = h;
    paintFrontList();
  }
  // "the day's changes": the last 24 h, or DeepState's latest update when it skipped a day
  function recentChanges() {
    var ch = (frontData && frontData.changes) || [];
    var day = ch.filter(function (c) { return c.t > Date.now() - 864e5; });
    if (day.length || !ch.length) return day;
    var last = Math.max.apply(null, ch.map(function (c) { return c.t; }));
    return ch.filter(function (c) { return c.t === last; });
  }
  function ddmm(t) { var d = new Date(t); return d.getDate() + '.' + ('0' + (d.getMonth() + 1)).slice(-2); }
  // Week replay: rings appear day by day (oldest first) while the corner shows the date. Seven single
  // repaints 700 ms apart, no transitions (SVG transitions on the big map cost frames on the box).
  var replayTimer = null;
  function replayFront() {
    if (!frontLayer || !frontData || mapLayer() !== 'front' || document.body.classList.contains('bg-paused')) return;
    clearTimeout(replayTimer);
    var step = 7, rings = frontLayer.querySelectorAll('.chg'), box = $('front-changes');
    (function next() {
      // show what had happened by that day: rings at least `step` days old
      for (var k = 0; k < rings.length; k++) rings[k].style.display = step < 0 || +rings[k].getAttribute('data-day') >= step ? '' : 'none';
      if (box) { box.classList.toggle('replay', step >= 0); box.setAttribute('data-date', step >= 0 ? 'Тиждень на фронті · ' + ddmm(Date.now() - step * 864e5) : ''); }
      if (step-- < 0) return;
      replayTimer = setTimeout(next, 700);
    })();
  }
  setInterval(replayFront, 10 * 60000);
  function paintFrontList() {
    var box = $('front-changes');
    if (!box || !frontData) return;
    var ch = recentChanges(), all = frontData.changes || [], html = '';
    if (!ch.length) {
      var d = frontData.lastChange ? new Date(frontData.lastChange) : null;
      html = '<div class="fc-h">За добу без змін</div>' + (d ? '<div class="fc-r info">останнє оновлення ' + d.getDate() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '</div>' : '');
    } else {
      var en = ch.filter(function (c) { return c.kind === 'enemy'; }).map(function (c) { return c.name; });
      var ou = ch.filter(function (c) { return c.kind === 'ours'; }).map(function (c) { return c.name; });
      var inf = ch.filter(function (c) { return c.kind === 'info'; }).map(function (c) { return c.name; });
      var ld = new Date(frontData.lastChange || ch[0].t);
      html = '<div class="fc-h">' + (ch[0].t < Date.now() - 864e5 ? 'Останні зміни · ' + ddmm(ld) : 'Зміни за добу') + '</div>';
      if (en.length) html += '<div class="fc-r enemy"><i></i>ворог просунувся біля ' + en.join(', ') + '</div>';
      if (ou.length) html += '<div class="fc-r ours"><i></i>ЗСУ: ' + ou.join(', ') + '</div>';
      if (inf.length) html += '<div class="fc-r info"><i></i>уточнено: ' + inf.join(', ') + '</div>';
    }
    var wEn = {}, wOu = {};
    all.forEach(function (c) { if (c.t > Date.now() - 7 * 864e5) (c.kind === 'enemy' ? wEn : c.kind === 'ours' ? wOu : {})[c.name] = 1; });
    var nEn = Object.keys(wEn).length, nOu = Object.keys(wOu).length;
    if (nEn || nOu) html += '<div class="fc-w">за тиждень: ворог просунувся біля ' + nEn + ' н. п.' + (nOu ? ' · ЗСУ — ' + nOu : '') + '</div>';
    if (frontData.monthAgo) html += '<div class="fc-w"><i class="dash"></i>лінія фронту ' + ddmm(frontData.monthAgo.at) + ' (місяць тому)</div>';
    box.innerHTML = html;
  }
  setInterval(function () { if (mapLayer() === 'front') loadFront(); }, 30 * 60000);

  // ---------- power outages (svitlo aggregator: oblenergo / DTEK / YASNO schedules) ----------
  var POWER_REGION = { 'м. Київ': 'kyiv', 'Київська область': 'kyiv-region', 'Одеська область': 'odesa', 'Дніпропетровська область': 'dnipro-region',
    'Харківська область': 'kharkiv', 'Львівська область': 'lviv', 'Запорізька область': 'zaporizhzhia', 'Полтавська область': 'poltava',
    'Черкаська область': 'cherkasy', 'Чернігівська область': 'chernihiv', 'Житомирська область': 'zhytomyr', 'Хмельницька область': 'khmelnytskyi',
    'Івано-Франківська область': 'ivano-frankivsk', 'Рівненська область': 'rivne', 'Тернопільська область': 'ternopil', 'Закарпатська область': 'zakarpattia' };
  var powerData = null;
  function powerRegion() { var c = cityInfo(); return c.name === 'Дніпро' ? 'dnipro' : POWER_REGION[c.oblast] || null; }
  function powerQueue() {
    try { var v = (localStorage.getItem('tv-powerq') || '').split('|'); return v[0] === powerRegion() ? v[1] || null : null; } catch (e) { return null; }
  }
  function loadPower() {
    var r = powerRegion();
    if (!r) { powerData = null; paintPower(); return; }
    getJSON('https://tvhome.pichkur.com/api/public/power?region=' + r, function (err, d) {
      if (!err && d && d.queues) { powerData = d; paintPower(); }
    });
  }
  function paintPowerSetting() {
    var el = $('set-powerq'); if (!el) return;
    el.textContent = !powerRegion() ? 'немає даних для області' : powerQueue() ? 'черга ' + powerQueue() : 'не показувати';
  }
  function hhmm(slot) { var m = (slot % 48) * 30; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
  function inText(min) { var h = Math.floor(min / 60), m = min % 60; return h ? h + ' год' + (m ? ' ' + m + ' хв' : '') : m + ' хв'; }
  function paintPower() {
    var row = $('power'), q = powerQueue();
    var qd = null;
    if (powerData && q) powerData.queues.forEach(function (x) { if (x.id === q) qd = x; });
    row.hidden = !qd;
    if (!qd) return;
    // the schedule as 96 half-hours from today's midnight: 0 light, 1 off, 2 possible, ? not published
    var today = new Date(), iso = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
    var t1 = powerData.today === iso ? qd.today : powerData.tomorrow === iso ? qd.tomorrow : null;
    var t2 = powerData.today === iso ? qd.tomorrow : null;
    var s = (t1 || new Array(49).join('?')) + (t2 || new Array(49).join('?'));
    var nowMin = today.getHours() * 60 + today.getMinutes(), i = Math.floor(nowMin / 30);
    var bar = '';
    for (var k = i; k < i + 48; k++) bar += '<i class="p' + (s[k] === '?' ? 'u' : s[k]) + '"></i>';
    var text, state = 'ok';
    var day = function (slot) { return slot >= 48 ? 'завтра ' : ''; };
    if (s[i] === '1' || s[i] === '2') {
      var j = i; while (j < 96 && s[j] === s[i]) j++;
      state = s[i] === '1' ? 'off' : 'maybe';
      text = (s[i] === '1' ? 'Світла немає' : 'Можливе відключення') + (j < 96 && s[j] !== '?' ? ' · до ' + day(j) + hhmm(j) : '');
    } else {
      var n = i; while (n < i + 48 && s[n] !== '1' && s[n] !== '2') n++;
      if (n < i + 48) {
        var e = n; while (e < 96 && s[e] === s[n]) e++;
        state = 'soon';
        text = (s[n] === '1' ? 'Відключення ' : 'Можливе відключення ') + day(n) + hhmm(n) + '–' + hhmm(e) + ' · через ' + inText(n * 30 - nowMin);
      } else if (!t1 && !t2) text = 'Графіків відключень немає';
      else text = 'Світло є · відключень не заплановано';
    }
    row.className = 'power ' + state;
    $('power-text').textContent = text;
    $('power-q').textContent = 'черга ' + q;
    if ($('power-bar').getAttribute('data-k') !== bar) { $('power-bar').innerHTML = bar; $('power-bar').setAttribute('data-k', bar); }
  }
  setInterval(paintPower, 60000);
  setInterval(loadPower, 10 * 60000);
  setTimeout(loadPower, 1500);
  function paintAlerts() {
    var al = data.alerts || {};
    var st = al.states || {}, ds = al.districts || {}, cm = al.communities || {};
    raionEls.forEach(function (r) {
      var lv = (r.id.indexOf('oblast:') === 0 ? '' : ds[r.id]) || st[r.oblast] || '';
      if (lv === r.lv) return; // touch the SVG only when something changed
      var fresh = lv && !r.lv && painted ? ' flash' : '';
      r.lv = lv;
      r.el.setAttribute('class', 'raion' + (lv ? ' ' + lv : '') + fresh);
    });
    painted = true;
    // communities (громади) under alert, drawn over their district
    var ids = Object.keys(cm).sort();
    var key = ids.map(function (i) { return i + cm[i].level; }).join(',');
    if (key !== commKey) {
      commKey = key;
      var html = '';
      ids.forEach(function (i) { html += '<path class="comm ' + cm[i].level + '" d="' + cm[i].d + '"/>'; });
      commLayer.innerHTML = html;
    }
  }

  // Targets are kept by id, so a moving Shahed glides to its new spot instead of blinking.
  var threatEls = {};
  function iconSvg(kind) {
    return '<svg viewBox="-15 -15 30 30"><path d="' + (kind === 'missile' ? MISSILE : SHAHED) + '"/></svg>';
  }
  function paintThreats() {
    var seen = {};
    (data.threats || []).forEach(function (t) {
      seen[t.id] = true;
      var p = toScreen(t.lon, t.lat);
      var rot = t.heading == null ? 0 : t.heading;
      var item = threatEls[t.id];
      var pos = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)';
      if (!item) {
        var g = document.createElement('div');
        g.className = 't ' + t.kind + ' enter';
        g.innerHTML = '<div class="rot">' + iconSvg(t.kind) + '</div><b></b>';
        var tr = [];
        for (var k = 0; k < 3; k++) { var dot = document.createElement('i'); dot.className = 'trail t' + k; threatLayer.insertBefore(dot, threatLayer.firstChild); tr.push(dot); }
        g.style.transform = pos;
        threatLayer.appendChild(g);
        item = threatEls[t.id] = { g: g, inner: g.firstChild, label: g.lastChild, rot: rot, kind: t.kind, cls: '', trail: tr };
        item.inner.style.transform = 'rotate(' + rot + 'deg)';
        requestAnimationFrame(function () { requestAnimationFrame(function () { g.classList.remove('enter'); }); });
      }
      var cls = 't ' + t.kind + (t.stale ? ' stale' : t.ageMin == null || t.ageMin <= 5 ? ' fresh' : t.ageMin <= 15 ? ' aging' : ' old');
      if (cls !== item.cls) { item.g.className = cls; item.cls = cls; }
      if (pos !== item.pos) { item.g.style.transform = pos; item.pos = pos; }
      var d = ((rot - item.rot) % 360 + 540) % 360 - 180; // shortest way round
      if (d) { item.rot += d; item.inner.style.transform = 'rotate(' + item.rot + 'deg)'; }
      // fading trail: up to 3 earlier positions, oldest faintest
      var pts = t.trail || [];
      for (var q = 0; q < 3; q++) {
        var pt = pts[pts.length - 1 - q], dotEl = item.trail[q];
        if (!pt) { dotEl.style.opacity = '0'; continue; }
        var sp = toScreen(pt[1], pt[0]);
        dotEl.style.opacity = '';
        dotEl.style.transform = 'translate(' + sp[0].toFixed(1) + 'px,' + sp[1].toFixed(1) + 'px)';
      }
      var lab = t.count > 1 ? '×' + t.count : '';
      if (lab !== item.lab) { item.label.textContent = lab; item.lab = lab; }
    });
    Object.keys(threatEls).forEach(function (id) {
      if (seen[id]) return;
      var g = threatEls[id].g;
      threatEls[id].trail.forEach(function (d) { if (d.parentNode) d.parentNode.removeChild(d); });
      delete threatEls[id];
      g.classList.add('leave');
      setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 800);
    });
  }

  var KIND_LABEL = { uav: 'Шахед / БпЛА', jet: 'Реактивний шахед', missile: 'Ракети', kab: 'КАБ', other: 'Інше' };
  var KIND_ICON = { uav: '#ffffff', jet: '#ffb08a', missile: '#ff6b5e', kab: '#f3d36b', other: '#c8c3b8' };
  var legendHtml = null;
  function paintLegend() {
    var html = '';
    ['jet', 'uav', 'missile', 'kab', 'other'].forEach(function (k) {
      var n = data.counts && data.counts[k];
      if (!n) return;
      html += '<div class="row"><svg viewBox="-15 -15 30 30"><path d="' + (k === 'missile' ? MISSILE : SHAHED) + '" fill="' + KIND_ICON[k] + '" stroke="#10131a" stroke-width="1.6"/></svg>' + KIND_LABEL[k] + ' ' + n + '</div>';
    });
    if (html !== legendHtml) { $('legend').innerHTML = html; legendHtml = html; }
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

  // ---------- weather icons (code = WMO; night shows the real moon phase) ----------
  function moonPhase(d) {
    var syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14) / 864e5;
    var p = ((d.getTime() / 864e5 - ref) % syn + syn) % syn / syn; // 0 new … .5 full
    return p;
  }
  function moonSvg(cx, cy, r) {
    var p = moonPhase(new Date());
    var lit = p <= 0.5 ? p * 2 : (1 - p) * 2;       // 0 … 1 illuminated
    var waxing = p < 0.5;
    var k = Math.cos(lit * Math.PI);                 // terminator ellipse
    var rx = Math.abs(k) * r;
    var outer = waxing ? 1 : 0, sweep = (k > 0) === waxing ? 0 : 1;
    var d = 'M' + cx + ',' + (cy - r) + ' A' + r + ',' + r + ' 0 0,' + outer + ' ' + cx + ',' + (cy + r) + ' A' + rx.toFixed(2) + ',' + r + ' 0 0,' + sweep + ' ' + cx + ',' + (cy - r) + 'Z';
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" class="moon-dark"/><path d="' + d + '" class="moon"/>';
  }
  var SUN = '<circle cx="16" cy="16" r="5.5" class="sun"/><g class="rays"><path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.1 2.1M22.4 22.4l2.1 2.1M7.5 24.5l2.1-2.1M22.4 9.6l2.1-2.1"/></g>';
  var CLOUD = '<path class="cloud" d="M10 25h13.5a5.5 5.5 0 0 0 .6-10.97A7.5 7.5 0 0 0 9.6 16.1 4.5 4.5 0 0 0 10 25z"/>';
  function wxIcon(code, day) {
    var sky = day ? SUN : moonSvg(16, 15, 8);
    var small = day ? '<g transform="translate(-5 -5) scale(.8)">' + SUN + '</g>' : '<g transform="translate(-4 -5) scale(.8)">' + moonSvg(16, 15, 8) + '</g>';
    var drops = '<path class="rain" d="M12 27.5l-1 2.5M17 27.5l-1 2.5M22 27.5l-1 2.5"/>';
    var flakes = '<path class="snow" d="M12 28.5h.01M17 29.5h.01M22 28.5h.01"/>';
    if (code <= 1) return sky;
    if (code === 2) return small + CLOUD;
    if (code === 3) return CLOUD;
    if (code === 45 || code === 48) return '<path class="fog" d="M5 13h22M7 18h18M5 23h22"/>';
    if (code >= 51 && code <= 57) return '<g transform="translate(0 -3)">' + CLOUD + '</g><path class="rain" d="M13 27v1.5M19 27v1.5"/>';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '<g transform="translate(0 -3)">' + CLOUD + '</g>' + drops;
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '<g transform="translate(0 -3)">' + CLOUD + '</g>' + flakes;
    if (code >= 95) return '<g transform="translate(0 -3)">' + CLOUD + '</g><path class="bolt" d="M17 22l-3 5h3l-2 4"/>';
    return CLOUD;
  }

  // ---------- day arc: the sun travels from sunrise to sunset; at night the moon crosses the dark arc ----------
  function arcPoint(t) { // quadratic bezier M40 100 Q400 -20 760 100
    var u = 1 - t;
    return [u * u * 40 + 2 * u * t * 400 + t * t * 760, u * u * 100 + 2 * u * t * -20 + t * t * 100];
  }
  function paintArc() {
    var w = data && data.weather;
    if (!w) return;
    var now = Date.now();
    var rise = new Date(w.sunrise[0]).getTime(), set = new Date(w.sunset[0]).getTime(), rise2 = new Date(w.sunrise[1]).getTime();
    var day = now >= rise && now <= set, t, from, to, label;
    if (day) {
      t = (now - rise) / (set - rise); from = rise; to = set;
      var left = Math.round((set - now) / 60000);
      label = 'до заходу ' + (left >= 60 ? Math.floor(left / 60) + ' год ' + (left % 60) + ' хв' : left + ' хв');
    } else {
      var nightStart = now > set ? set : rise - (rise2 - set), nightEnd = now > set ? rise2 : rise;
      t = (now - nightStart) / (nightEnd - nightStart); from = nightStart; to = nightEnd;
      var l2 = Math.round((nightEnd - now) / 60000);
      label = 'до світанку ' + (l2 >= 60 ? Math.floor(l2 / 60) + ' год ' + (l2 % 60) + ' хв' : l2 + ' хв');
    }
    t = Math.max(0, Math.min(1, t));
    var p = arcPoint(t);
    var arc = $('arc');
    arc.classList.toggle('night', !day);
    $('arc-sun').setAttribute('cx', p[0].toFixed(1)); $('arc-sun').setAttribute('cy', p[1].toFixed(1));
    $('arc-glow').setAttribute('cx', p[0].toFixed(1)); $('arc-glow').setAttribute('cy', p[1].toFixed(1));
    // progress: draw the done part of the curve with a dash
    var done = $('arc-done'), len = done.getTotalLength ? done.getTotalLength() : 800;
    done.style.strokeDasharray = (len * t).toFixed(1) + ' ' + len.toFixed(1);
    $('arc-rise').textContent = (day ? '☀ ' : '☾ ') + hhmm(new Date(from));
    $('arc-set').textContent = hhmm(new Date(to));
    $('arc-label').textContent = label;
  }
  setInterval(function () { if (data) paintArc(); }, 60000);

  // ---------- rates + headlines ----------
  var newsPage = 0, newsKey = '';
  function ago(iso) {
    if (!iso) return '';
    var m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return m < 60 ? m + ' хв' : Math.floor(m / 60) + ' год';
  }
  function paintInfo() {
    var r = data.rates || {};
    ['USD', 'EUR', 'PLN'].forEach(function (c) {
      if (!r[c]) return;
      $('r-' + c).textContent = r[c].rate.toFixed(2);
      var d = r[c].delta, el = $('d-' + c);
      el.textContent = d == null || Math.abs(d) < 0.005 ? '' : (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(2);
      el.className = d > 0 ? 'up' : d < 0 ? 'down' : '';
    });
    var n = data.news;
    if (!n || !n.items || !n.items.length) return;
    $('news-args').textContent = n.source;
    var key = n.items.map(function (x) { return x.title; }).join('|');
    if (key !== newsKey) { newsKey = key; newsPage = 0; renderNews(); }
  }
  function renderNews() {
    var n = data && data.news, fl = footballLine();
    var hasNews = n && n.items && n.items.length;
    if (!hasNews && !fl) return;
    // a live match stays on; a match today/tomorrow or a fresh result alternates with the news
    var showBall = !!fl && (fl.live || !hasNews || newsPage % 2 === 0);
    var x = showBall ? null : n.items[newsPage % n.items.length];
    var box = $('news');
    box.classList.add('swap');
    setTimeout(function () {
      box.innerHTML = '<span class="t"></span> <span class="ago"></span>';
      box.firstChild.textContent = showBall ? '⚽ ' + fl.text : x.title;
      box.lastChild.textContent = showBall ? fl.tag : ago(x.at);
      box.classList.toggle('ball', showBall);
      box.classList.toggle('live', !!(showBall && fl.live));
      $('news-args').textContent = showBall ? fl.league : n.source;
      box.classList.remove('swap');
    }, 350);
  }

  // ---------- football: the chosen team's match (TheSportsDB) ----------
  var TEAMS = [['', 'не показувати'], ['133915', 'Збірна України'], ['134426', 'Карпати'], ['133944', 'Динамо'], ['134126', 'Шахтар'],
    ['140180', 'Полісся'], ['146860', 'ЛНЗ'], ['142826', 'Кривбас'], ['134422', 'Зоря'], ['135911', 'Верес'], ['136858', 'Колос'],
    ['134122', 'Металіст 1925'], ['134392', 'Чорноморець'], ['146857', 'Епіцентр'], ['149227', 'Кудрівка'], ['147624', 'Лівий Берег'], ['146855', 'Буковина']];
  var TEAM_UA = { 'Ukraine': 'Україна', 'Karpaty Lviv': 'Карпати', 'Dynamo Kyiv': 'Динамо', 'Shakhtar Donetsk': 'Шахтар', 'Polissya Zhytomyr': 'Полісся',
    'LNZ Cherkasy': 'ЛНЗ', 'Kryvbas Kryvyi Rih': 'Кривбас', 'Zorya Luhansk': 'Зоря', 'Veres Rivne': 'Верес', 'Kolos Kovalivka': 'Колос', 'Kharkiv': 'Металіст 1925',
    'Chornomorets Odesa': 'Чорноморець', 'Epitsentr Kamianets-Podilsky': 'Епіцентр', 'Kudrivka': 'Кудрівка', 'Livyi Bereh Kyiv': 'Лівий Берег',
    'Bukovyna Chernivtsi': 'Буковина', 'Obolon Kyiv': 'Оболонь', 'Rukh Lviv': 'Рух', 'Oleksandriya': 'Олександрія',
    'N.Ireland': 'Півн. Ірландія', 'Northern Ireland': 'Півн. Ірландія', 'Hungary': 'Угорщина', 'Poland': 'Польща', 'Germany': 'Німеччина', 'France': 'Франція',
    'Spain': 'Іспанія', 'Italy': 'Італія', 'England': 'Англія', 'Portugal': 'Португалія', 'Netherlands': 'Нідерланди', 'Belgium': 'Бельгія',
    'Croatia': 'Хорватія', 'Serbia': 'Сербія', 'Romania': 'Румунія', 'Slovakia': 'Словаччина', 'Czech Republic': 'Чехія', 'Georgia': 'Грузія',
    'Iceland': 'Ісландія', 'Albania': 'Албанія', 'Austria': 'Австрія', 'Switzerland': 'Швейцарія', 'Sweden': 'Швеція', 'Norway': 'Норвегія',
    'Denmark': 'Данія', 'Finland': 'Фінляндія', 'Scotland': 'Шотландія', 'Wales': 'Уельс', 'Ireland': 'Ірландія', 'Turkey': 'Туреччина',
    'Greece': 'Греція', 'Moldova': 'Молдова', 'Lithuania': 'Литва', 'Latvia': 'Латвія', 'Estonia': 'Естонія', 'Bosnia-Herzegovina': 'Боснія і Герцеговина',
    'Slovenia': 'Словенія', 'Bulgaria': 'Болгарія', 'Israel': 'Ізраїль', 'Azerbaijan': 'Азербайджан', 'Armenia': 'Вірменія', 'Kazakhstan': 'Казахстан' };
  var LEAGUE_UA = { 'Ukrainian Premier League': 'УПЛ', 'UEFA Nations League': 'Ліга націй', 'UEFA Champions League': 'Ліга чемпіонів', 'UEFA Europa League': 'Ліга Європи',
    'UEFA Europa Conference League': 'Ліга конференцій', 'UEFA Conference League': 'Ліга конференцій', 'FIFA World Cup': 'Чемпіонат світу',
    'World Cup Qualifying UEFA': 'Відбір ЧС', 'UEFA European Championship': 'Євро', 'International Friendlies': 'Товариський', 'Ukrainian Cup': 'Кубок України' };
  var ballData = null;
  function teamId() { try { return localStorage.getItem('tv-team') || ''; } catch (e) { return ''; } }
  function teamName() { var id = teamId(), n = 'не показувати'; TEAMS.forEach(function (t) { if (t[0] === id) n = t[1]; }); return n; }
  function loadBall() {
    var id = teamId();
    if (!id) { ballData = null; return; }
    getJSON('https://tvhome.pichkur.com/api/public/football?team=' + id, function (err, d) { if (!err && d) { ballData = d; if (d.live) renderNews(); } });
  }
  function ua(n) { return TEAM_UA[n] || n; }
  // the line for the news slot: a live score, a result from the last 14 h, or a match today/tomorrow
  function footballLine() {
    var d = ballData;
    if (!d || !teamId()) return null;
    var now = Date.now(), today = new Date(); today.setHours(0, 0, 0, 0);
    var hm = function (t) { var x = new Date(t); return ('0' + x.getHours()).slice(-2) + ':' + ('0' + x.getMinutes()).slice(-2); };
    var lg = function (e) { return LEAGUE_UA[e.league] || e.league || ''; };
    var L = d.live;
    if (L && !/^(FT|AET|PEN|AP|CANC|PST|ABD)$/.test(L.status || '')) {
      var st = L.status === 'HT' ? 'перерва' : L.status === '1H' ? '1-й тайм' : L.status === '2H' ? '2-й тайм' : L.progress ? L.progress + "'" : 'наживо';
      return { live: true, text: ua(L.home) + ' ' + (L.hs == null ? 0 : L.hs) + ':' + (L.as == null ? 0 : L.as) + ' ' + ua(L.away), tag: st, league: lg(L) };
    }
    var fin = L && L.hs != null ? L : d.last;
    if (fin && fin.hs != null && now - fin.at < 14 * 3600e3)
      return { text: ua(fin.home) + ' ' + fin.hs + ':' + fin.as + ' ' + ua(fin.away), tag: 'фінал', league: lg(fin) };
    var n = d.next;
    if (n && n.at > now - 3 * 3600e3) {
      var dd = Math.floor((n.at - today.getTime()) / 864e5);
      if (dd === 0 || dd === 1) return { text: (dd ? 'завтра ' : 'сьогодні ') + hm(n.at) + ' · ' + ua(n.home) + ' — ' + ua(n.away), tag: '', league: lg(n) };
    }
    return null;
  }
  setInterval(loadBall, 2 * 60000);
  setTimeout(loadBall, 2500);

  setInterval(function () { newsPage++; renderNews(); }, 12000);

  // ---------- data ----------
  function paint() {
    if (!data) return;
    var w = data.weather;
    if (w) {
      $('weather').textContent = 'зараз ' + w.temp + '° · ' + w.text;
      var wxKey = w.code + '|' + w.isDay + '|' + new Date().getDate();
      if ($('wx-icon').getAttribute('data-k') !== wxKey) { $('wx-icon').innerHTML = wxIcon(w.code, w.isDay); $('wx-icon').setAttribute('data-k', wxKey); }
    }
    var fc = data.forecast;
    if (fc) {
      $('weather-next').textContent = fc.label + ' ' + fc.max + '°/' + fc.min + '° · ' + fc.text;
      var t = fc.precip ? fc.precip.kind + ' з ' + pad(fc.precip.from) + ':00 до ' + pad(fc.precip.to % 24) + ':00 · ' + fc.advice : fc.advice.charAt(0).toUpperCase() + fc.advice.slice(1);
      $('fc-text').textContent = t;
      $('t-wx').classList.toggle('rain', !!fc.precip);
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
      $('pi-text').textContent = 'pi гріється: ' + bits.join(' · ');
      // Only shown when it matters: SSD overheating is what used to freeze the Pi; CPU throttles at 80–85°.
      var level = (pi.disk >= 75 || pi.cpu >= 80) ? 'hot' : (pi.disk >= 68 || pi.cpu >= 76) ? 'warn' : '';
      $('pi-line').hidden = !level;
    }
    paintInfo();
    var alarm = !!(data.alerts && data.alerts.city && data.alerts.city.active) || /[?&]alarm/.test(location.search);
    var cur = alarmTarget === null ? document.body.classList.contains('alarm') : alarmTarget;
    if (alarm !== cur) {
      alarmTarget = alarm;
      // One repaint, hidden: fade the map out, switch the alarm look and the zoom together, fade back in.
      var clip = document.querySelector('.map-clip');
      var swap = function () {
        document.body.classList.toggle('alarm', alarm);
        document.body.classList.toggle('map-zoomed', alarm);
        if (geo) { setViewBox(alarm); relayoutMap(); }
        greet();
        alarmTarget = null;
      };
      if (clip) {
        clip.classList.add('fading');
        setTimeout(function () { swap(); requestAnimationFrame(function () { requestAnimationFrame(function () { clip.classList.remove('fading'); }); }); }, 300);
      } else swap();
      greet();
    }
    var a = data.alerts && data.alerts.city;
    var line = $('alert-line');
    if (!data.alerts) {
      line.className = 'status unknown';
      $('alert-text').textContent = 'Немає даних про тривоги';
    } else if (a && a.active) {
      line.className = 'status on';
      var mins = a.since ? Math.max(1, Math.round((Date.now() - Date.parse(a.since)) / 60000)) : null;
      $('alert-text').textContent = 'Тривога ' + cityInfo().loc + (mins ? ' · ' + (mins >= 60 ? Math.floor(mins / 60) + ' год ' + (mins % 60) + ' хв' : mins + ' хв') : '');
    } else {
      line.className = 'status';
      $('alert-text').textContent = cap(cityInfo().loc) + ' спокійно';
    }
    paintArc();
    var n = data.inSky || 0;
    countTo('sky-n', n);
    $('sky-word').textContent = plural(n, 'ціль', 'цілі', 'цілей');
    countTo('sky-now-n', n);
    countTo('sky-t', data.today || 0);
    $('sky-now-word').textContent = plural(n, 'ціль', 'цілі', 'цілей');
    countTo('sky-today', data.today);
    if (geo) { paintAlerts(); paintThreats(); paintBadges(); paintLegend(); }
  }

  function getJSON(url, cb) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.timeout = 8000;
    x.onload = function () { if (x.status === 200) { try { cb(null, JSON.parse(x.responseText)); } catch (e) { cb(e); } } else cb(new Error(x.status)); };
    x.onerror = x.ontimeout = function () { cb(new Error('net')); };
    x.send();
  }
  var pageVersion = null;
  var alarmTarget = null;
  function poll() {
    getJSON('api/state', function (err, d) {
      if (err) return;
      // a newer page on the Pi → reload (keeps the TV in sync with edits)
      if (d.webVersion && pageVersion && d.webVersion !== pageVersion) { location.reload(); return; }
      if (d.webVersion) pageVersion = d.webVersion;
      data = d;
      var hk = cityInfo().name;
      if (hk !== homeKey) { homeKey = hk; paintHomeOblast(); if (geo && threatLayer) { setViewBox(document.body.classList.contains('map-zoomed')); relayoutMap(); } greet(); }
      paint(); paintBackground();
    });
  }
  getJSON('ukraine.json', function (err, g) { if (!err) { geo = g; drawMap(); applyMapLayer(); paint(); } });
  poll();
  // 01:00–07:00: data every 30 s instead of 5 s and no ambient motion (radar ping, glint)
  function isNight() { var h = new Date().getHours(); return h >= 1 && h < 7; }
  var lastPoll = 0;
  setInterval(function () {
    var night = isNight();
    document.body.classList.toggle('night', night);
    if (night && Date.now() - lastPoll < 29000) return;
    lastPoll = Date.now();
    poll();
  }, CFG.pollMs || 5000);

  // ---------- apps ----------
  var apps = [];
  function loadApps() {
    var list = [];
    if (TV && TV.apps) { try { list = JSON.parse(TV.apps()); } catch (e) { list = []; } }
    else {
      list = [
        { pkg: 'top.rootu.lamps', label: 'Lampa' }, { pkg: 'com.google.android.youtube.tv', label: 'YouTube' },
        { pkg: 'com.megogo.application', label: 'MEGOGO' }, { pkg: 'com.netflix.ninja', label: 'Netflix' },
        { pkg: 'studio.scillarium.ottnavigator', label: 'OTT Navigator' }, { pkg: 'demo.x', label: 'Kodi' },
      ];
    }
    var hidden = CFG.hidden || [];
    apps = list.filter(function (a) { return hidden.indexOf(a.pkg) < 0 && a.pkg !== 'pl.pichkur.tvhome'; });
  }
  // Focus glow takes the logo's colour: average of the saturated pixels of its banner.
  var glowCache = {};
  function glowFrom(pkg, src, el, prop) {
    prop = prop || '--glow';
    if (glowCache[pkg]) { el.style.setProperty(prop, glowCache[pkg]); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = 32; c.height = 18;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0, 32, 18);
        var d = x.getImageData(0, 0, 32, 18).data, r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) {
          var mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
          if (mx - mn < 60 || mx < 70) continue; // skip greys, white, black
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        var col = n > 8 ? 'rgba(' + Math.round(r / n) + ',' + Math.round(g / n) + ',' + Math.round(b / n) + ',.75)' : 'rgba(255,255,255,.35)';
        glowCache[pkg] = col;
        el.style.setProperty(prop, col);
      } catch (e) {}
    };
    img.src = src;
  }
  function tile(a) {
    var b = document.createElement('button');
    b.className = 'tile';
    b.setAttribute('data-pkg', a.pkg);
    if (a.banner) { b.className += ' banner'; b.style.backgroundImage = 'url(' + a.banner + ')'; glowFrom(a.pkg, a.banner, b); }
    else if (a.icon) { var i = document.createElement('img'); i.className = 'icon'; i.src = a.icon; b.appendChild(i); }
    else { b.className += ' text'; b.appendChild(document.createTextNode(a.label)); }
    var l = document.createElement('span'); l.className = 'label'; l.textContent = a.label; b.appendChild(l);
    b.setAttribute('aria-label', a.label);
    return b;
  }
  function dockList() {
    try { var v = JSON.parse(localStorage.getItem('tv-dock') || 'null'); if (v && v.length) return v; } catch (e) {}
    return CFG.favorites || [];
  }
  function saveDock(list) { try { localStorage.setItem('tv-dock', JSON.stringify(list)); } catch (e) {} }
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
    var fav = dockList();
    var byPkg = {};
    apps.forEach(function (a) { byPkg[a.pkg] = a; });
    var cont = continueTile(byPkg);
    if (cont) dock.appendChild(cont);
    fav.forEach(function (p) { if (byPkg[p]) dock.appendChild(tile(byPkg[p])); });
    SYS.filter(function (b) { return !(window.TVC && TVC.sysHidden(b.action)); }).forEach(function (b, i) {
      var el2 = document.createElement('button');
      el2.className = 'sys' + (i === 0 ? ' first' : '');
      el2.setAttribute('data-action', b.action);
      el2.setAttribute('aria-label', b.label);
      el2.innerHTML = '<svg viewBox="0 0 24 24">' + b.icon + '</svg>';
      dock.appendChild(el2);
    });
    paintWifi();
    paintSeason();
    if (netState !== 'ok') setNet(netState);
  }
  // One thin, rounded icon set (Lucide-style geometry, 24 px grid, 1.7 stroke).
  var SYS = [
    { action: 'apps', label: 'Усі програми', icon: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>' },
    { action: 'wifi', label: 'Мережа', icon: '<path class="w3" d="M2 8.8a15 15 0 0 1 20 0"/><path class="w2" d="M5 12.9a10 10 0 0 1 14 0"/><path class="w1" d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01" stroke-width="2.6"/>' },
    { action: 'quick', label: 'Швидкі налаштування', icon: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>' },
    { action: 'settings', label: 'Налаштування', icon: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>' },
  ];
  // «Продовжити»: the newest Android TV "Play Next" item, Lampa first.
  function continueTile(byPkg) {
    var list = [];
    if (TV && TV.watchNext) { try { list = JSON.parse(TV.watchNext()); } catch (e) { list = []; } }
    else if (/[?&]demo/.test(location.search)) {
      list = [{ pkg: 'top.rootu.lamps', title: 'Тед Лассо', episode: 'Шахи', season: '3', number: '4', position: 1560000, duration: 2700000, art: null, intent: 'x' }];
    }
    if (!list.length) return null;
    var lampa = list.filter(function (x) { return x.pkg === 'top.rootu.lamps'; });
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
    if (z === 'wizard') return document.querySelectorAll('#wizard .wz-row');
    if (z === 'settings') return document.querySelectorAll('#settings .set-row');
    if (z === 'appmenu') return document.querySelectorAll('#appmenu .am-row');
    if (z === 'player') return Array.prototype.filter.call(document.querySelectorAll('#player .pl-btn'), function (b) { return b.offsetParent !== null; });
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
    var gc = f.style.getPropertyValue('--glow');
    g.style.setProperty('--glint', gc ? gc.replace(/,\s*[\d.]+\)$/, ',.45)') : 'rgba(255,255,255,.20)');
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
    // carousel: the focused card is largest, its neighbours a little smaller, the rest smaller still
    var trk = $('track');
    if (trk) {
      trk.classList.toggle('has-focus', zone === 'dock');
      var kids = trk.children;
      for (var q = 0; q < kids.length; q++) {
        var dd = zone === 'dock' ? Math.abs(q - idx.dock) : 9;
        kids[q].classList.toggle('n1', dd === 1);
      }
    }
    moveGlint(f);
    if ((zone === 'grid' || zone === 'settings') && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
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
    var media = elm.getAttribute('data-media');
    if (media) { if (TV && TV.mediaAction) TV.mediaAction(media); setTimeout(pollMedia, 500); return; }
    var intent = elm.getAttribute('data-intent');
    if (intent) { if (TV && TV.openIntent) TV.openIntent(intent); return; }
    var pkg = elm.getAttribute('data-pkg');
    var action = elm.getAttribute('data-action');
    if (pkg) { try { localStorage.setItem('opened:' + pkg, Date.now()); } catch (e) {} if (TV && TV.launch) TV.launch(pkg); return; }
    if (action === 'apps') return openDrawer();
    if (action === 'layout') return toggleLayout();
    if (action === 'quick') { if (window.TVS) TVS.quick(); return; }
    if (action === 'settings') return openSettings();
    if (TV && TV.openSettings) TV.openSettings(action);
  }
  // ---------- UI sounds (Web Audio, synthesized: a soft tick on move, a two-note chime on launch) ----------
  var actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { return null; } }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function blip(freq, at, dur, vol, type) {
    var c = audio();
    if (!c) return;
    var t0 = c.currentTime + (at || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.82, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var audioReported = false;
  function reportAudio() {
    if (audioReported || !actx) return;
    audioReported = true;
    setTimeout(function () { diag('audio-' + actx.state + '-' + Math.round((actx.baseLatency || 0) * 1000) + 'ms'); }, 500);
  }
  function play(name, fallback) {
    try { if (localStorage.getItem('tv-sounds') === '0') return; } catch (e) {} // Settings → Система → Звуки меню
    if (TV && TV.sound) { try { TV.sound(name); return; } catch (e) {} }
    fallback();
  }
  var SOUND_WEB = {
    move: function () { blip(1450, 0, 0.045, 0.06, 'triangle'); reportAudio(); },
    edge: function () { blip(520, 0, 0.07, 0.05, 'triangle'); },
    open: function () { blip(880, 0, 0.12, 0.08); blip(1320, 0.07, 0.18, 0.07); },
    back: function () { blip(990, 0, 0.09, 0.06); blip(700, 0.05, 0.12, 0.05); },
  };
  var SOUND = {
    move: function () { play('move', SOUND_WEB.move); },
    edge: function () { play('edge', SOUND_WEB.edge); },
    open: function () { play('open', SOUND_WEB.open); },
    back: function () { play('back', SOUND_WEB.back); },
  };

  // ---------- launcher settings: city, shelf, map size ----------
  var THEMES = [
    { id: 'lviv', name: 'Вечірній Львів' },
    { id: 'aurora', name: 'Північне сяйво' },
    { id: 'sunset', name: 'Захід над Карпатами' },
    { id: 'sapphire', name: 'Сапфір і золото' },
    { id: 'neon', name: 'Неон' },
    { id: 'copper', name: 'Графіт і мідь' },
  ];
  // themes removed in 1.44 (Північ, Карпати, Папір, Термінал) fall back to the default
  function themeId() { try { var t = localStorage.getItem('tv-theme') || 'lviv'; return THEMES.some(function (x) { return x.id === t; }) ? t : 'lviv'; } catch (e) { return 'lviv'; } }
  function applyTheme(id) {
    THEMES.forEach(function (t) { document.body.classList.remove('theme-' + t.id); });
    if (id !== 'lviv') document.body.classList.add('theme-' + id);
    document.documentElement.className = '';
    try { localStorage.setItem('tv-theme', id); } catch (e) {}
    var t = THEMES.filter(function (x) { return x.id === id; })[0];
    if ($('set-theme') && t) $('set-theme').textContent = t.name;
    clockShown = ''; $('clock').innerHTML = ''; tickClock(); // re-measure digit slots for the new font
  }
  applyTheme(themeId());
  // 3D map on by default; "2D" in settings
  function map3d() { try { return localStorage.getItem('tv-map3d') !== '0'; } catch (e) { return true; } }
  document.body.classList.toggle('map-3d', map3d());
  if (TV && TV.isLite && TV.isLite()) document.body.classList.add('lite');
  var cities = [];
  getJSON('cities.json', function (err, c) { if (!err) cities = c; });
  // ---------- first-run wizard (shown once; the owner's box is marked done) ----------
  var wiz = { step: 0, ok: false };
  function wizardNeeded() { try { return !localStorage.getItem('tv-setup-done'); } catch (e) { return false; } }
  function openWizard() {
    loadApps();
    // shelf: the known players that are installed, in a sensible order
    if (!localStorage.getItem('tv-dock')) {
      var have = {}; apps.forEach(function (a) { have[a.pkg] = 1; });
      var pick = (CFG.favorites || []).concat(['com.google.android.youtube.tv', 'com.netflix.ninja', 'com.megogo.application', 'com.spotify.tv.android', 'org.videolan.vlc'])
        .filter(function (p, i, arr) { return have[p] && arr.indexOf(p) === i; });
      if (pick.length < 3) pick = apps.slice(0, 6).map(function (a) { return a.pkg; });
      saveDock(pick.slice(0, 6)); buildDock();
    }
    if (window.TVS) { TVS.wizard(); return; } // the new wizard (setup.js)
    wiz.step = 0; renderWizard();
    $('wizard').hidden = false; zone = 'wizard'; idx.wizard = 0; render();
  }
  function renderWizard() {
    var steps = [
      { t: 'Вітаю у «Вітальні»', b: 'Головний екран для телевізора: годинник, погода, тривоги й небо над Україною. Налаштуємо за хвилину.', btn: 'Почати' },
      { t: 'Ваше місто', b: 'Від міста залежать погода, схід сонця, тривоги «у моєму місті» й позначка на карті.', city: true, btn: 'Далі' },
      { t: 'Головний екран', b: 'Щоб кнопка «Додому» на пульті відкривала «Вітальню», зробіть її головним екраном.', home: true, btn: 'Вибрати головний екран' },
      { t: 'Тривоги поверх фільмів', b: 'Щоб під час тривоги поверх YouTube чи фільму з’являлося повідомлення, а кнопка «Додому» поверталася сюди, увімкніть «Вітальня» у Спеціальних можливостях.', a11y: true, btn: 'Відкрити налаштування' },
      { t: 'Готово', b: 'Полиця з програмами внизу. Шестерня — налаштування: тема, фон, макет, місто й порядок програм.', btn: 'Почати користуватися' },
    ];
    var lite = TV && TV.isLite && TV.isLite();
    if (lite) steps = steps.filter(function (x) { return !x.a11y; });
    // already the home screen (or no bridge in a browser preview): no need to ask
    // decided once per wizard run, so the step list doesn't shift after the user picks the home screen
    if (wiz.askHome == null) wiz.askHome = !!(TV && TV.isDefaultHome && !TV.isDefaultHome());
    if (!wiz.askHome) steps = steps.filter(function (x) { return !x.home; });
    // the full edition brings Home back through Accessibility anyway, so the step is only a nicety there
    else if (!lite) steps.forEach(function (x) { if (x.home) x.b += ' Якщо приставка не дасть вибрати — нічого страшного: на наступному кроці «Вітальня» сама повертатиме кнопку «Додому».'; });
    wiz.max = steps.length - 1;
    var st = steps[wiz.step];
    wiz.cur = st;
    if (st.home && TV && TV.isDefaultHome && TV.isDefaultHome()) { st.b = '✓ «Вітальня» — головний екран.'; st.btn = 'Далі'; st.homeDone = true; }
    var html = '<div class="wz-dots">' + steps.map(function (x, i) { return '<i class="' + (i === wiz.step ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
      '<h1></h1><p></p>';
    if (st.city) html += '<button class="set-row wz-row" data-wz="city"><span class="nm">Місто</span><b>' + cityName() + '</b><i>◀ ▶</i></button>';
    if (st.a11y) {
      var on = TV && TV.a11yEnabled ? TV.a11yEnabled() : false;
      html += '<div class="wz-state ' + (on ? 'ok' : '') + '">' + (on ? '✓ Увімкнено' : 'Ще не увімкнено · знайдіть «Вітальня: головний екран» і увімкніть') + '</div>';
      if (on) st.btn = 'Далі';
    }
    html += '<button class="set-row wz-row wz-main" data-wz="next"><span class="nm"></span><b>›</b></button>';
    if (st.home && wiz.homeTried) html = html.replace('<button class="set-row wz-row wz-main"', '<div class="wz-state">' + (lite ? 'Ця приставка не дає змінити головний екран. Відкривайте «Вітальню» з полиці програм або встановіть повну версію з сайту — вона повертає кнопку «Додому» сама.' : 'Приставка не дала вибрати — увімкніть «Вітальню» на наступному кроці.') + '</div><button class="set-row wz-row wz-main"');
    if (st.a11y || st.home) html += '<button class="set-row wz-row" data-wz="skip"><span class="nm">' + (st.home && wiz.homeTried ? 'Далі' : 'Пропустити') + '</span></button>';
    var box = $('wizard-box');
    box.innerHTML = html;
    box.querySelector('h1').textContent = st.t;
    box.querySelector('p').textContent = st.b;
    box.querySelector('.wz-main .nm').textContent = st.btn;
    idx.wizard = Math.min(idx.wizard || 0, items('wizard').length - 1);
    if (st.city || st.a11y) idx.wizard = 0;
    render();
  }
  function wizardAct(row, dir) {
    var kind = row.getAttribute('data-wz');
    if (kind === 'city') { settingsAct(document.querySelector('[data-set=city]'), dir || 1); setTimeout(renderWizard, 50); return; }
    if (kind === 'skip') { wiz.step++; renderWizard(); return; }
    if (kind === 'next') {
      var lite = TV && TV.isLite && TV.isLite();
      if (!lite && wiz.cur && wiz.cur.a11y && !(TV && TV.a11yEnabled && TV.a11yEnabled())) { if (TV && TV.openSettings) TV.openSettings('accessibility'); return; }
      if (wiz.cur && wiz.cur.home && !wiz.cur.homeDone && TV && TV.chooseHome) { TV.chooseHome(); wiz.homeTried = true; setTimeout(renderWizard, 2500); return; }
      if (wiz.step === wiz.max) { try { localStorage.setItem('tv-setup-done', '1'); } catch (e) {} $('wizard').hidden = true; zone = 'dock'; idx.dock = 0; render(); return; }
      wiz.step++; idx.wizard = 0; renderWizard();
    }
  }
  function wizardKey(k, code) {
    var rows = items('wizard'), row = rows[idx.wizard];
    if (k === 'ArrowDown' || code === 20) { idx.wizard = Math.min(rows.length - 1, idx.wizard + 1); return 'move'; }
    if (k === 'ArrowUp' || code === 19) { idx.wizard = Math.max(0, idx.wizard - 1); return 'move'; }
    if ((k === 'ArrowRight' || code === 22) && row && row.getAttribute('data-wz') === 'city') { wizardAct(row, 1); return 'move'; }
    if ((k === 'ArrowLeft' || code === 21) && row && row.getAttribute('data-wz') === 'city') { wizardAct(row, -1); return 'move'; }
    if (k === 'Enter' || code === 13 || code === 23) { if (row) wizardAct(row, 0); return 'open'; }
    if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || code === 4 || code === 27) { if (wiz.step > 0) { wiz.step--; renderWizard(); } return 'back'; }
    return null;
  }

  // ---------- 6. update banner ----------
  function paintUpdate() {
    if (!TV || !TV.updateInfo) return;
    var u = {};
    try { u = JSON.parse(TV.updateInfo()); } catch (e) { return; }
    var has = u.latest && u.current && u.latest > u.current;
    var b = $('set-update');
    if (b) b.textContent = has ? 'є нова версія · ОК — оновити' : 'версія ' + (u.name || '') + ' · найновіша';
    document.body.classList.toggle('has-update', !!has);
  }
  setInterval(paintUpdate, 60000);
  window.tvUpdateFailed = function () { var b = $('set-update'); if (b) b.textContent = 'не вдалося завантажити, спробуйте пізніше'; };

  function openSettings() {
    loadApps();
    if (window.TVS) { TVS.open(); return; } // the sectioned settings (setup.js)
    renderSettings();
    $('settings').hidden = false;
    zone = 'settings'; idx.settings = 0; render();
  }
  function closeSettings() {
    $('settings').hidden = true;
    buildDock();
    zone = 'dock'; idx.dock = 0; render();
  }
  function renderSettings() {
    $('set-city').textContent = cityName();
    $('set-layout').textContent = layoutName();
    $('set-bg').textContent = bgName();
    $('set-map3d').textContent = map3d() ? '3D' : '2D';
    paintPowerSetting();
    $('set-maplayer').textContent = MAP_LAYER_NAME[mapLayer()];
    $('set-team').textContent = teamName();
    paintSpeedSetting();
    $('set-season').textContent = seasonOn() ? 'авто' : 'вимк.';
    $('set-notchmap').textContent = TV && TV.notchMap && TV.notchMap() ? 'увімк.' : 'вимк.';
    paintUpdate();
    var list = dockList(), byPkg = {};
    apps.forEach(function (a) { byPkg[a.pkg] = a; });
    var on = list.filter(function (p) { return byPkg[p]; });
    var off = apps.filter(function (a) { return on.indexOf(a.pkg) < 0; }).sort(function (x, y) { return x.label.localeCompare(y.label, 'uk'); });
    var html = '';
    on.forEach(function (p, i) { html += appRow(byPkg[p], i + 1); });
    off.forEach(function (a) { html += appRow(a, 0); });
    $('set-apps').innerHTML = html;
  }
  function appRow(a, n) {
    var pic = a.icon || a.banner || '';
    return '<button class="set-row app' + (n ? ' on' : '') + '" data-set="app" data-pkg-set="' + a.pkg + '">' +
      '<span class="ic"' + (pic ? ' style="background-image:url(' + pic + ')"' : '') + '></span>' +
      '<span class="nm">' + a.label.replace(/</g, '&lt;') + '</span>' +
      '<b>' + (n ? 'на полиці · ' + n : 'сховано') + '</b></button>';
  }
  function settingsAct(row, dir) {
    var kind = row.getAttribute('data-set');
    if (kind === 'notchmap') {
      if (TV && TV.setNotchMap) TV.setNotchMap(!TV.notchMap());
      $('set-notchmap').textContent = TV && TV.notchMap && TV.notchMap() ? 'увімк.' : 'вимк.';
      return;
    }
    if (kind === 'speed') { speedTest(); return; }
    if (kind === 'editor') { closeSettings(); if (window.TVC) TVC.open(); return; }
    if (kind === 'season') {
      try { localStorage.setItem('tv-season', seasonOn() ? '0' : '1'); } catch (e) {}
      $('set-season').textContent = seasonOn() ? 'авто' : 'вимк.';
      paintSeason();
      return;
    }
    if (kind === 'team') {
      var ti2 = 0;
      TEAMS.forEach(function (t, j) { if (t[0] === teamId()) ti2 = j; });
      try { localStorage.setItem('tv-team', TEAMS[(ti2 + (dir || 1) + TEAMS.length) % TEAMS.length][0]); } catch (e) {}
      $('set-team').textContent = teamName();
      ballData = null; loadBall();
      return;
    }
    if (kind === 'powerq') {
      var ids = [''].concat(powerData && powerData.id === powerRegion() ? powerData.queues.map(function (x) { return x.id; }) : []);
      var at = Math.max(0, ids.indexOf(powerQueue() || ''));
      var nq = ids[(at + (dir || 1) + ids.length) % ids.length];
      try { localStorage.setItem('tv-powerq', nq ? powerRegion() + '|' + nq : ''); } catch (e) {}
      paintPowerSetting(); paintPower();
      return;
    }
    if (kind === 'maplayer') {
      var li = MAP_LAYERS.indexOf(mapLayer());
      try { localStorage.setItem('tv-maplayer', MAP_LAYERS[(li + (dir || 1) + MAP_LAYERS.length) % MAP_LAYERS.length]); } catch (e) {}
      applyMapLayer();
      $('set-maplayer').textContent = MAP_LAYER_NAME[mapLayer()];
      return;
    }
    if (kind === 'map3d') {
      try { localStorage.setItem('tv-map3d', map3d() ? '0' : '1'); } catch (e) {}
      document.body.classList.toggle('map-3d', map3d());
      $('set-map3d').textContent = map3d() ? '3D' : '2D';
      return;
    }
    if (kind === 'bg') {
      var bi = BG_CHOICES.indexOf(bgChoice());
      var nb = BG_CHOICES[(bi + (dir || 1) + BG_CHOICES.length) % BG_CHOICES.length];
      try { localStorage.setItem('tv-bg', nb); } catch (e) {}
      bgPhase = null; paintBackground();
      $('set-bg').textContent = bgName();
    $('set-map3d').textContent = map3d() ? '3D' : '2D';
    paintUpdate();
      return;
    }
    if (kind === 'theme') {
      var ti = 0;
      THEMES.forEach(function (t, j) { if (t.id === themeId()) ti = j; });
      applyTheme(THEMES[(ti + (dir || 1) + THEMES.length) % THEMES.length].id);
      return;
    }
    if (kind === 'city') {
      if (!cities.length) return;
      var i = 0;
      cities.forEach(function (c, j) { if (c.name === cityName()) i = j; });
      setCityObj(cities[(i + (dir || 1) + cities.length) % cities.length]);
    } else if (kind === 'layout') {
      stepLayout(dir || 1);
    } else if (kind === 'update') {
      var u = {}; try { u = JSON.parse(TV.updateInfo()); } catch (e) {}
      if (u.latest > u.current) { $('set-update').textContent = 'завантажую…'; TV.installUpdate(); }
      else { TV.checkUpdate(); $('set-update').textContent = 'перевіряю…'; setTimeout(paintUpdate, 4000); }
    } else if (kind === 'android') {
      if (TV && TV.openSettings) TV.openSettings('android');
    } else if (kind === 'app') {
      var pkg = row.getAttribute('data-pkg-set'), list = dockList().slice(), at = list.indexOf(pkg);
      if (!dir) { if (at >= 0) list.splice(at, 1); else list.push(pkg); }
      else if (at >= 0) { var to = Math.max(0, Math.min(list.length - 1, at + dir)); list.splice(at, 1); list.splice(to, 0, pkg); }
      else return;
      saveDock(list);
      renderSettings();
      var rows = items('settings');
      for (var r = 0; r < rows.length; r++) if (rows[r].getAttribute('data-pkg-set') === pkg) idx.settings = r;
    }
  }
  function setCityObj(c) {
    if (TV && TV.setCity) TV.setCity(JSON.stringify(c));
    data = data || {}; data.cityInfo = c; data.city = c.name;
    homeKey = ''; $('set-city').textContent = c.name;
    powerData = null; loadPower(); paintPowerSetting();
    setTimeout(poll, 600); setTimeout(poll, 3000);
  }
  function settingsKey(k, code) {
    var rows = items('settings'), row = rows[idx.settings];
    if (k === 'ArrowDown' || code === 20) { idx.settings = Math.min(rows.length - 1, idx.settings + 1); return 'move'; }
    if (k === 'ArrowUp' || code === 19) { idx.settings = Math.max(0, idx.settings - 1); return 'move'; }
    if (k === 'ArrowRight' || code === 22) { if (row) settingsAct(row, 1); return 'move'; }
    if (k === 'ArrowLeft' || code === 21) { if (row) settingsAct(row, -1); return 'move'; }
    if (k === 'Enter' || code === 13 || code === 23) { if (row) settingsAct(row, 0); return 'open'; }
    if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || code === 4 || code === 27) { closeSettings(); return 'back'; }
    return null;
  }

  var COLS = 6;
  // ---------- app menu: hold OK (or press Menu) on an app → open / move / shelf / info / uninstall ----------
  var press = null, moving = null, menuFor = null, menuFrom = null;
  function appOf(pkg) { for (var i = 0; i < apps.length; i++) if (apps[i].pkg === pkg) return apps[i]; return null; }
  function openAppMenu(elm) {
    var pkg = elm && elm.getAttribute('data-pkg');
    var a = pkg && appOf(pkg);
    if (!a) return;
    menuFor = pkg; menuFrom = zone;
    var onShelf = dockList().indexOf(pkg) >= 0;
    var rows = [['open', 'Відкрити']];
    if (onShelf && zone === 'dock') rows.push(['move', 'Перемістити']);
    rows.push(onShelf ? ['unshelf', 'Прибрати з полиці'] : ['shelf', 'Додати на полицю']);
    rows.push(['info', 'Інформація про програму']);
    if (!a.sys && TV && TV.uninstall) rows.push(['uninstall', 'Видалити']);
    var pic = a.icon || a.banner || '';
    $('am-ic').style.backgroundImage = pic ? 'url(' + pic + ')' : '';
    $('am-name').textContent = a.label;
    $('am-rows').innerHTML = rows.map(function (r) { return '<button class="set-row am-row' + (r[0] === 'uninstall' ? ' danger' : '') + '" data-am="' + r[0] + '"><span class="nm">' + r[1] + '</span></button>'; }).join('');
    $('appmenu').hidden = false;
    zone = 'appmenu'; idx.appmenu = 0; render();
    SOUND.open();
  }
  function closeAppMenu() { $('appmenu').hidden = true; zone = menuFrom || 'dock'; render(); }
  function appMenuAct(kind) {
    var pkg = menuFor, list = dockList().slice();
    closeAppMenu();
    if (kind === 'open') { var t = document.querySelector('.focus'); if (t) activate(t); }
    else if (kind === 'move') { moving = pkg; paintMoving(); }
    else if (kind === 'shelf') { list.push(pkg); saveDock(list); buildDock(); render(); }
    else if (kind === 'unshelf') { list.splice(list.indexOf(pkg), 1); saveDock(list); buildDock(); render(); }
    else if (kind === 'info') { if (TV && TV.openSettings) TV.openSettings('app:' + pkg); }
    else if (kind === 'uninstall') { if (TV && TV.uninstall) TV.uninstall(pkg); }
  }
  function paintMoving() {
    var all = document.querySelectorAll('.tile.moving');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('moving');
    $('move-hint').hidden = !moving;
    if (!moving) return;
    var t = document.querySelector('#track [data-pkg="' + moving + '"]');
    if (t) t.classList.add('moving');
  }
  // Move mode: ◀ ▶ swap the app with its neighbour on the shelf, OK / Back / ▼ finish.
  function moveKey(k, code) {
    var list = dockList().slice(), at = list.indexOf(moving);
    if (k === 'ArrowRight' || code === 22 || k === 'ArrowLeft' || code === 21) {
      var to = at + (k === 'ArrowRight' || code === 22 ? 1 : -1);
      if (at < 0 || to < 0 || to >= list.length) { SOUND.edge(); return; }
      list.splice(at, 1); list.splice(to, 0, moving); saveDock(list);
      buildDock();
      var kids = $('track').children;
      for (var i = 0; i < kids.length; i++) if (kids[i].getAttribute('data-pkg') === moving) idx.dock = i;
      render(); paintMoving(); SOUND.move();
      return;
    }
    if (k === 'Enter' || code === 13 || code === 23 || k === 'Escape' || k === 'Backspace' || k === 'GoBack' || code === 4 || code === 27 || k === 'ArrowDown' || code === 20 || k === 'ArrowUp' || code === 19) {
      moving = null; paintMoving(); SOUND.back();
    }
  }
  document.addEventListener('keyup', function (e) {
    if (!press || !(e.key === 'Enter' || e.keyCode === 13 || e.keyCode === 23)) return;
    clearTimeout(press.t);
    var p = press; press = null;
    e.preventDefault();
    if (!p.long) { SOUND.open(); activate(p.el); }
  });
  document.addEventListener('keydown', function (e) {
    var k = e.key || '';
    var code = e.keyCode;
    var list = items(zone);
    var before = zone + ':' + idx[zone];
    if (zone === 'appmenu') {
      var rows = items('appmenu');
      if (k === 'ArrowDown' || code === 20) { idx.appmenu = Math.min(rows.length - 1, idx.appmenu + 1); SOUND.move(); }
      else if (k === 'ArrowUp' || code === 19) { idx.appmenu = Math.max(0, idx.appmenu - 1); SOUND.move(); }
      else if (k === 'Enter' || code === 13 || code === 23) { if (!e.repeat && !press) { var r = rows[idx.appmenu]; if (r) { SOUND.open(); appMenuAct(r.getAttribute('data-am')); } } }
      else if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || code === 4 || code === 27) { SOUND.back(); closeAppMenu(); }
      else return;
      e.preventDefault(); if (zone === 'appmenu') render();
      return;
    }
    if (moving) { e.preventDefault(); moveKey(k, code); return; }
    var cur = list[idx[zone]];
    var isApp = (zone === 'dock' || zone === 'grid') && cur && cur.getAttribute && cur.getAttribute('data-pkg');
    if ((k === 'ContextMenu' || code === 82) && isApp) { e.preventDefault(); openAppMenu(cur); return; }
    // OK on an app: a short press opens it on release, holding it ~0.55 s opens the menu
    if ((k === 'Enter' || code === 13 || code === 23) && isApp) {
      e.preventDefault();
      if (press) return;
      press = { el: cur, long: false };
      press.t = setTimeout(function () { if (press) { press.long = true; openAppMenu(press.el); } }, 550);
      return;
    }
    if (zone === 'wizard') {
      var wr = wizardKey(k, code);
      if (!wr) return;
      e.preventDefault(); render(); SOUND[wr === 'move' ? 'move' : wr]();
      return;
    }
    if (zone === 'settings') {
      var r = settingsKey(k, code);
      if (!r) return;
      e.preventDefault();
      render();
      SOUND[r === 'move' ? 'move' : r]();
      return;
    }
    // two-row shelf: tiles flow column by column (the «Продовжити» card spans both rows)
    var two = zone === 'dock' && window.TVC && TVC.cfg().shelfRows === 2;
    var off2 = two && list[0] && list[0].classList.contains('cont') ? 1 : 0;
    var row2 = function (i) { return i < off2 ? -1 : (i - off2) % 2; };
    if (two && (k === 'ArrowRight' || code === 22)) idx.dock = idx.dock < off2 ? off2 : Math.min(list.length - 1, idx.dock + 2);
    else if (two && (k === 'ArrowLeft' || code === 21)) idx.dock = idx.dock < off2 ? idx.dock : idx.dock - off2 < 2 ? (off2 ? 0 : idx.dock) : idx.dock - 2;
    else if (two && (k === 'ArrowDown' || code === 20) && row2(idx.dock) === 0 && idx.dock + 1 < list.length) idx.dock++;
    else if (two && (k === 'ArrowUp' || code === 19) && row2(idx.dock) === 1) idx.dock--;
    else if (k === 'ArrowRight' || code === 22) idx[zone]++;
    else if (k === 'ArrowLeft' || code === 21) idx[zone]--;
    else if (k === 'ArrowUp' || code === 19) {
      if (zone === 'dock') { zone = 'player'; idx.player = $('player').classList.contains('last') ? 0 : 1; }
      else if (zone === 'grid') idx.grid = idx.grid >= COLS ? idx.grid - COLS : idx.grid;
    } else if (k === 'ArrowDown' || code === 20) {
      if (zone === 'player') zone = 'dock';
      else if (zone === 'grid' && idx.grid + COLS < list.length) idx.grid += COLS;
    } else if (k === 'Enter' || code === 13 || code === 23) {
      SOUND.open();
      activate(list[idx[zone]]);
    } else if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || code === 4 || code === 27) {
      SOUND.back();
      if (zone === 'grid') closeDrawer();
      else { zone = 'dock'; idx.dock = 0; }
    } else return;
    e.preventDefault();
    render();
    if (code >= 19 && code <= 22 || /^Arrow/.test(k)) {
      var after = zone + ':' + idx[zone];
      (after === before ? SOUND.edge : SOUND.move)();
    }
  });
  document.addEventListener('click', function (e) {
    var am = e.target.closest ? e.target.closest('[data-am]') : null;
    if (am) { appMenuAct(am.getAttribute('data-am')); return; }
    var t = e.target.closest ? e.target.closest('[data-pkg],[data-action],[data-intent],[data-media]') : null;
    if (t) activate(t);
  });

  // ---------- time-of-day background ----------
  // Palettes stay dark so text and the map keep their contrast.
  // Backgrounds: rich, saturated but dark enough for white text. "auto" follows the sun in the chosen city.
  var PHASES = {
    night:  { name: 'Ніч', bg: 'radial-gradient(90% 70% at 78% 8%, #23409a 0%, transparent 62%), radial-gradient(80% 70% at 8% 100%, #3a1d6e 0%, transparent 60%), linear-gradient(180deg, #08102c 0%, #0a1233 55%, #0c0f26 100%)', stars: true },
    dawn:   { name: 'Світанок', bg: 'radial-gradient(100% 70% at 30% 110%, #e0663f 0%, transparent 58%), radial-gradient(80% 60% at 85% 0%, #5b2a7e 0%, transparent 60%), linear-gradient(180deg, #1c1240 0%, #3d1a4e 55%, #6a2a3a 100%)' },
    day:    { name: 'День', bg: 'radial-gradient(90% 70% at 80% 0%, #2a7bd0 0%, transparent 60%), radial-gradient(70% 60% at 0% 100%, #0e6b78 0%, transparent 60%), linear-gradient(180deg, #0b2f5c 0%, #0b2547 55%, #0a1a33 100%)' },
    golden: { name: 'Золото', bg: 'radial-gradient(100% 70% at 85% 110%, #e88a2a 0%, transparent 58%), radial-gradient(70% 60% at 10% 0%, #7a2f1a 0%, transparent 60%), linear-gradient(180deg, #2a140c 0%, #4a2210 55%, #6a3412 100%)' },
    dusk:   { name: 'Сутінки', bg: 'radial-gradient(100% 70% at 20% 110%, #c23a6b 0%, transparent 58%), radial-gradient(80% 60% at 90% 0%, #3b2a9a 0%, transparent 60%), linear-gradient(180deg, #120f3a 0%, #2a1550 55%, #451a48 100%)', stars: true },
    aurora: { name: 'Сяйво', bg: 'radial-gradient(60% 50% at 25% 15%, #13a37a 0%, transparent 65%), radial-gradient(60% 55% at 70% 25%, #5a3ec8 0%, transparent 65%), radial-gradient(70% 60% at 50% 110%, #0b4f6c 0%, transparent 60%), linear-gradient(180deg, #04121c 0%, #061826 60%, #050d18 100%)', stars: true },
    ocean:  { name: 'Океан', bg: 'radial-gradient(90% 70% at 15% 0%, #0a8fb0 0%, transparent 60%), radial-gradient(80% 60% at 100% 100%, #1d3fa8 0%, transparent 60%), linear-gradient(180deg, #03243a 0%, #042b44 55%, #031a2c 100%)' },
    wine:   { name: 'Вино', bg: 'radial-gradient(90% 70% at 80% 0%, #a3204a 0%, transparent 60%), radial-gradient(70% 60% at 0% 100%, #5a1a6a 0%, transparent 60%), linear-gradient(180deg, #24081a 0%, #300a22 55%, #1c0614 100%)' },
    black:  { name: 'Чорний', bg: '#000' },
  };
  var BG_CHOICES = ['city', 'streets', 'auto', 'night', 'dawn', 'day', 'golden', 'dusk', 'aurora', 'ocean', 'wine', 'black'];
  function bgChoice() { try { return localStorage.getItem('tv-bg') || 'streets'; } catch (e) { return 'streets'; } }
  function bgName() { var c = bgChoice(); return c === 'city' ? 'Місто · живе небо' : c === 'streets' ? 'Мапа міста' : c === 'auto' ? 'Градієнт · за сонцем' : PHASES[c].name; }
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
  // Rain / snow / fog from the real current weather, over any background. Each layer is a tiled
  // image moved by a compositor-only transform loop (no per-frame JS, no repaint).
  function paintWeatherFx() {
    var m = /[?&]wx=(\d+)/.exec(location.search);
    var code = m ? +m[1] : data && data.weather ? data.weather.code : -1;
    var kind = code >= 95 ? 'storm' : (code >= 61 && code <= 67) || (code >= 80 && code <= 82) ? 'rain' : code >= 51 && code <= 57 ? 'drizzle'
      : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : code === 45 || code === 48 ? 'fog' : '';
    var fx = $('wx-fx');
    if (fx.getAttribute('data-k') === kind) return;
    fx.setAttribute('data-k', kind);
    fx.className = 'wx-fx' + (kind ? ' ' + kind : '');
    fx.innerHTML = kind ? '<i class="far"></i><i class="near"></i>' : '';
  }
  var bgPhase = null, bgFront = 'bg-a';
  function paintBackground() {
    var choice = bgChoice();
    var ph = choice === 'auto' || choice === 'city' ? phaseNow() : choice === 'streets' ? 'black' : choice;
    document.body.classList.toggle('danger', !!(data && data.alerts && data.alerts.city && data.alerts.city.active));
    var sc = $('scene');
    if (sc && window.Scene) {
      if (choice === 'city') Scene.city(sc, cityInfo(), ph, data && data.weather);
      else if (choice === 'streets') Scene.streets(sc, cityInfo());
      else Scene.clear(sc);
    }
    document.body.classList.toggle('bg-streets', choice === 'streets');
    document.body.setAttribute('data-sun', phaseNow());
    paintWeatherFx();
    if (ph === bgPhase) return;
    var P2 = PHASES[ph];
    var back = bgFront === 'bg-a' ? 'bg-b' : 'bg-a';
    $(back).style.background = P2.bg;
    $(back).classList.add('on');
    $(bgFront).classList.remove('on');
    bgFront = back;
    $('stars').classList.toggle('on', !!P2.stars);
    document.body.setAttribute('data-phase', ph);
    bgPhase = ph;
  }
  (function makeStars() {
    var box = $('stars'), html = '';
    for (var i = 0; i < 22; i++) {
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
    var net = $('net'), level = 0, name;
    if (!w || w.type === 'none') name = 'немає мережі';
    else if (w.type === 'ethernet') { name = 'Ethernet'; level = 3; }
    else { name = w.ssid || 'Wi‑Fi'; level = w.level; }
    $('net-name').textContent = name;
    net.classList.toggle('down', !w || w.type === 'none');
    ['b1', 'b2', 'b3'].forEach(function (c, i) {
      var r = net.querySelector('.' + c);
      if (r) r.setAttribute('class', c + (level > i ? '' : ' off'));
    });
    ['w1', 'w2', 'w3'].forEach(function (c, i) {
      var p = document.querySelector('.sys .' + c);
      if (p) p.setAttribute('class', c + (level > i ? '' : ' off'));
    });
  }
  paintWifi();
  setInterval(paintWifi, 10000);

  // Is the internet actually there (not just Wi-Fi)? A tiny request every minute: slow → amber, none → red.
  var netState = 'ok', netMs = 0;
  function checkNet() {
    if (document.body.classList.contains('bg-paused')) return;
    var t0 = Date.now(), done = false;
    var fin = function (st) { if (done) return; done = true; netMs = Date.now() - t0; setNet(st === 'off' ? 'off' : netMs > 1500 ? 'slow' : 'ok'); };
    setTimeout(function () { fin('off'); }, 8000);
    try { fetch('https://www.gstatic.com/generate_204?t=' + t0, { mode: 'no-cors', cache: 'no-store' }).then(function () { fin('ok'); }, function () { fin('off'); }); }
    catch (e) { fin('off'); }
  }
  function setNet(st) {
    netState = st;
    var net = $('net');
    net.classList.toggle('net-slow', st === 'slow');
    net.classList.toggle('net-off', st === 'off');
    var w = document.querySelector('.sys[data-action=wifi]');
    if (w) { w.classList.toggle('net-slow', st === 'slow'); w.classList.toggle('net-off', st === 'off'); }
    var tag = $('net-state');
    if (tag) tag.textContent = st === 'off' ? ' · без інтернету' : st === 'slow' ? ' · повільний інтернет' : '';
  }
  setInterval(checkNet, 60000);
  setTimeout(checkNet, 4000);

  // Speed test (Settings → Інтернет): ping = best of 3 tiny requests, then a download sized to take ~3 s.
  var speedBusy = false;
  function speedTest() {
    if (speedBusy) return;
    speedBusy = true;
    var el = $('set-net'), base = 'https://speed.cloudflare.com/__down?bytes=';
    el.textContent = 'вимірюю пінг…';
    var pings = [];
    var ping = function (n) {
      if (!n) return Promise.resolve();
      var t0 = performance.now();
      return fetch(base + '0&r=' + Math.random(), { cache: 'no-store' }).then(function (r) { return r.arrayBuffer(); }).then(function () { pings.push(performance.now() - t0); return ping(n - 1); });
    };
    var down = function (bytes) {
      var t0 = performance.now();
      return fetch(base + bytes + '&r=' + Math.random(), { cache: 'no-store' }).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return { bytes: b.byteLength, s: (performance.now() - t0) / 1000 }; });
    };
    ping(3).then(function () {
      el.textContent = 'вимірюю швидкість…';
      return down(2e6);
    }).then(function (r1) {
      var mbps = r1.bytes * 8 / r1.s / 1e6;
      var big = Math.min(100e6, Math.max(5e6, Math.round(mbps * 1e6 / 8 * 3)));
      return down(big);
    }).then(function (r2) {
      var mbps = r2.bytes * 8 / r2.s / 1e6, p = Math.round(Math.min.apply(null, pings));
      var txt = '↓ ' + (mbps >= 10 ? Math.round(mbps) : mbps.toFixed(1)) + ' Мбіт/с · пінг ' + p + ' мс';
      el.textContent = txt;
      try { localStorage.setItem('tv-speed', txt + ' · ' + new Date().toLocaleDateString('uk-UA')); } catch (e) {}
      speedBusy = false;
    }).catch(function () { el.textContent = 'не вдалося виміряти · немає інтернету?'; speedBusy = false; });
  }
  function paintSpeedSetting() {
    var v = ''; try { v = localStorage.getItem('tv-speed') || ''; } catch (e) {}
    if (!speedBusy) $('set-net').textContent = v ? v : 'перевірити швидкість';
  }

  // ---------- mini player ----------
  function fmtTime(ms) {
    var s2 = Math.floor(ms / 1000), h = Math.floor(s2 / 3600), m = Math.floor(s2 % 3600 / 60), sec = s2 % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(sec);
  }
  var mediaKey = '';
  function pollMedia() {
    var m = {};
    if (TV && TV.media) { try { m = JSON.parse(TV.media()); } catch (e) { m = {}; } }
    else if (/[?&]demo/.test(location.search)) m = { live: true, playing: true, app: 'YouTube', pkg: 'com.google.android.youtube.tv', title: 'Lofi Girl — beats to relax/study to', sub: 'Lofi Girl', position: 1534000, duration: 3600000 };
    var pl = $('player');
    if (!m.title) { pl.className = 'player empty'; mediaKey = ''; return; }
    pl.className = 'player' + (m.live ? '' : ' last') + (m.playing ? ' playing' : '');
    if (!m.title) return;
    var key = (m.pkg || '') + '|' + m.title + '|' + apps.length; // re-pick the art once the app list (logos) is in
    if (key !== mediaKey) {
      mediaKey = key;
      $('pl-title').textContent = m.title;
      var art = $('pl-art');
      var appInfo = null;
      for (var ai = 0; ai < apps.length; ai++) if (apps[ai].pkg === m.pkg) appInfo = apps[ai];
      var pic = m.art || (appInfo && (appInfo.banner || appInfo.icon)) || '';
      art.style.backgroundImage = pic ? 'url(' + pic + ')' : '';
      art.classList.toggle('has', !!pic);
      art.classList.toggle('logo', !m.art && !!pic);
      if (appInfo && appInfo.banner) glowFrom(m.pkg, appInfo.banner, pl, '--pl-accent');
      setTimeout(function () { var c = pl.style.getPropertyValue('--pl-accent'); if (c) pl.style.setProperty('--pl-accent-soft', c.replace(/,\s*[\d.]+\)$/, ',.22)')); }, 300);
    }
    $('pl-app').textContent = m.live ? (m.app || 'плеєр') : m.appOnly ? 'остання програма' : 'продовжити · ' + (m.app || '');
    $('pl-state').textContent = m.live ? (m.playing ? '▶ грає' : '❚❚ пауза') : 'ОК — відкрити';
    var sub = m.sub || '';
    if (m.duration > 0) sub = (sub ? sub + ' · ' : '') + fmtTime(m.position || 0) + ' / ' + fmtTime(m.duration);
    $('pl-sub').textContent = sub;
    var frac = m.duration > 0 ? Math.min(1, (m.position || 0) / m.duration) : 0;
    $('pl-fill').style.transform = 'scaleX(' + frac.toFixed(4) + ')';
    $('pl-toggle').innerHTML = m.playing ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
  }
  pollMedia();
  setInterval(pollMedia, 2000);

  // ---------- big map <-> compact map with a big player ----------
  // ---------- layouts (arrangement of the screen; independent of the colour theme) ----------
  var LAYOUTS = [
    { id: 'classic', name: 'Класика' },
    { id: 'compact', name: 'Плеєр' },
    { id: 'cinema', name: 'Кіно' },
    { id: 'mirror', name: 'Дзеркало' },
    { id: 'cards', name: 'Картки' },
    { id: 'minimal', name: 'Мінімал' },
  ];
  function layoutId() {
    try { var v = localStorage.getItem('tv-layout') || 'cinema'; return v === 'big' ? 'classic' : v; } catch (e) { return 'classic'; }
  }
  function layoutName() { var l = LAYOUTS.filter(function (x) { return x.id === layoutId(); })[0]; return l ? l.name : 'Класика'; }
  function applyLayout(id) {
    document.body.classList.remove('compact');
    LAYOUTS.forEach(function (l) { document.body.classList.remove('layout-' + l.id); });
    if (id === 'compact') document.body.classList.add('compact');
    else if (id !== 'classic') document.body.classList.add('layout-' + id);
    try { localStorage.setItem('tv-layout', id); } catch (e) {}
    if ($('set-layout')) $('set-layout').textContent = layoutName();
    setTimeout(relayoutMap, 80);
  }
  function setLayout(compact) { applyLayout(compact ? 'compact' : 'classic'); }
  function stepLayout(dir) {
    var i = 0;
    LAYOUTS.forEach(function (l, j) { if (l.id === layoutId()) i = j; });
    var next = LAYOUTS[(i + dir + LAYOUTS.length) % LAYOUTS.length].id;
    var st = $('stage');
    st.classList.add('relayout');
    setTimeout(function () { applyLayout(next); st.classList.remove('relayout'); }, 200);
  }
  function toggleLayout() { stepLayout(1); }
  applyLayout(layoutId());

  // Called by the launcher when the home screen comes back to the front.
  // Returning from an app must feel instant: show focus first, do the rest after the first frames.
  // The dock is rebuilt only when apps actually changed (the launcher bumps appsVersion).
  var dockVersion = -1;
  function appsVer() { try { return TV && TV.appsVersion ? TV.appsVersion() : 0; } catch (e) { return 0; } }
  window.tvResume = function () {
    if (!$('wizard').hidden) { renderWizard(); return; }
    if (!$('drawer').hidden) closeDrawer();
    zone = 'dock'; render();
    setTimeout(function () {
      var v = appsVer();
      if (v !== dockVersion) { dockVersion = v; loadApps(); buildDock(); render(); }
      pollMedia();
    }, 350);
    setTimeout(function () { poll(); paintWifi(); }, 700);
  };
  // Called by the launcher with Back while the drawer is open.
  window.tvBack = function () {
    if (!$('appmenu').hidden) { SOUND.back(); closeAppMenu(); return true; }
    if (moving) { moving = null; paintMoving(); SOUND.back(); return true; }
    if (!$('drawer').hidden) { SOUND.back(); closeDrawer(); return true; }
    if (!$('settings').hidden) { SOUND.back(); closeSettings(); return true; }
    if (!$('wizard').hidden) { if (wiz.step > 0) { wiz.step--; renderWizard(); } return true; }
    return false;
  };

  // hooks for the screen builder (custom.js)
  window.TVH = {
    holiday: holiday, getJSON: getJSON, SOUND: SOUND, ddmm: ddmm,
    front: function () { return frontData; }, loadFront: loadFront, recentChanges: recentChanges,
    ball: function () { return ballData; }, teamId: teamId, teamName: teamName, teamUA: ua,
    leagueUA: function (l) { return LEAGUE_UA[l] || l; },
    stepTeam: function (dir) { settingsAct({ getAttribute: function () { return 'team'; } }, dir); },
    buildDock: function () { buildDock(); render(); },
    act: function (kind, dir) { settingsAct({ getAttribute: function (a) { return a === 'data-set' ? kind : null; } }, dir); },
    renderLegacy: function () { renderSettings(); },
    closeSettings: function () { closeSettings(); },
    cities: function () { return cities; }, setCity: setCityObj, cityInfo: cityInfo,
    apps: function () { loadApps(); return apps; }, dockList: dockList, saveDock: saveDock,
    powerRegion: powerRegion, powerQueues: function () { return powerData && powerData.id === powerRegion() ? powerData.queues.map(function (x) { return x.id; }) : []; },
    powerQueue: powerQueue,
    setPowerQueue: function (q) { try { localStorage.setItem('tv-powerq', q ? powerRegion() + '|' + q : ''); } catch (e) {} paintPower(); },
    TEAMS: function () { return TEAMS; }, setTeam: function (id) { try { localStorage.setItem('tv-team', id); } catch (e) {} ballData = null; loadBall(); },
    THEMES: function () { return THEMES; }, themeId: themeId, BG_CHOICES: function () { return BG_CHOICES; }, bgChoice: bgChoice,
    LAYOUTS: function () { return LAYOUTS; }, layoutId: function () { return layoutId(); },
    MAP_LAYERS: function () { return MAP_LAYERS; }, mapLayer: mapLayer, map3d: map3d, seasonOn: seasonOn, wifi: function () { try { return JSON.parse(TV.wifi()); } catch (e) { return null; } },
    zoneDock: function () { zone = 'dock'; render(); },
    resetClock: function () { clockShown = ''; $('clock').innerHTML = ''; $('clock').removeAttribute('data-k'); tickClock(); },
  };
  dockVersion = appsVer(); loadApps(); buildDock(); render();
  if (TV && wizardNeeded()) setTimeout(openWizard, 600);
  setTimeout(paintUpdate, 5000);
  // Intro sequence lives in CSS (body.intro); typed welcome line here.
  (function typeWelcome() {
    var t = $('welcome-typed');
    t.setAttribute('data-typing', '1');
    t.textContent = '';
    t.removeAttribute('data-typing');
    greet();
    var text = t.textContent;
    t.setAttribute('data-typing', '1');
    var i = 0;
    t.textContent = '';
    var timer = setInterval(function () {
      t.textContent = text.slice(0, ++i);
      if (i >= text.length) { clearInterval(timer); t.removeAttribute('data-typing'); setTimeout(function () { var c = document.querySelector('.tcur'); if (c) c.remove(); }, 2500); }
    }, 45);
  })();
  setTimeout(function () { document.body.classList.remove('intro'); }, 4000);
})();
