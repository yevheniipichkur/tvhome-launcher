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
    $('date').textContent = DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
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
    map.setAttribute('viewBox', '-1 -1 ' + (geo.width + 2) + ' ' + (geo.height + 2));
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
    // alarm zoom centres on Lviv
    document.querySelector('.map-wrap').style.transformOrigin = p[0].toFixed(0) + 'px ' + p[1].toFixed(0) + 'px';
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
  var box = null;
  function toScreen(lon, lat) {
    if (!box) {
      var W = geo.width + 2, H = geo.height + 2, w = map.clientWidth, h = map.clientHeight;
      var k = Math.min(w / W, h / H);
      box = { k: k, ox: (w - W * k) / 2 + 1 * k, oy: (h - H * k) / 2 + 1 * k };
    }
    var q = proj(lon, lat);
    return [box.ox + q[0] * box.k, box.oy + q[1] * box.k];
  }

  // Top-view Shahed silhouette (nose up), rotated by heading; missile for rockets.
  var SHAHED = 'M0,-13 L2.2,-8.5 L2.2,-3 L13,6.5 L13,9.5 L2.2,6.8 L1.6,10.5 L4.2,12.5 L-4.2,12.5 L-1.6,10.5 L-2.2,6.8 L-13,9.5 L-13,6.5 L-2.2,-3 L-2.2,-8.5 Z';
  var MISSILE = 'M0,-14 L3,-7 L3,7 L6.5,12 L6.5,14 L-6.5,14 L-6.5,12 L-3,7 L-3,-7 Z';
  var DELTA = SHAHED;

  var commLayer, commKey = '';
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
    var n = data && data.news;
    if (!n || !n.items || !n.items.length) return;
    var x = n.items[newsPage % n.items.length];
    var box = $('news');
    box.classList.add('swap');
    setTimeout(function () {
      box.innerHTML = '<span class="t"></span> <span class="ago"></span>';
      box.firstChild.textContent = x.title;
      box.lastChild.textContent = ago(x.at);
      box.classList.remove('swap');
    }, 350);
  }
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
    if (alarm !== document.body.classList.contains('alarm')) {
      document.body.classList.toggle('alarm', alarm);
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
  function poll() {
    getJSON('api/state', function (err, d) {
      if (err) return;
      // a newer page on the Pi → reload (keeps the TV in sync with edits)
      if (d.webVersion && pageVersion && d.webVersion !== pageVersion) { location.reload(); return; }
      if (d.webVersion) pageVersion = d.webVersion;
      data = d;
      var hk = cityInfo().name;
      if (hk !== homeKey) { homeKey = hk; paintHomeOblast(); if (geo && threatLayer) relayoutMap(); greet(); }
      paint(); paintBackground();
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
    SYS.forEach(function (b, i) {
      var el2 = document.createElement('button');
      el2.className = 'sys' + (i === 0 ? ' first' : '');
      el2.setAttribute('data-action', b.action);
      el2.setAttribute('aria-label', b.label);
      el2.innerHTML = '<svg viewBox="0 0 24 24">' + b.icon + '</svg>';
      dock.appendChild(el2);
    });
    paintWifi();
  }
  // One thin, rounded icon set (Lucide-style geometry, 24 px grid, 1.7 stroke).
  var SYS = [
    { action: 'apps', label: 'Усі програми', icon: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>' },
    { action: 'wifi', label: 'Мережа', icon: '<path class="w3" d="M2 8.8a15 15 0 0 1 20 0"/><path class="w2" d="M5 12.9a10 10 0 0 1 14 0"/><path class="w1" d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01" stroke-width="2.6"/>' },
    { action: 'layout', label: 'Макет', icon: '<rect x="3" y="3.5" width="18" height="17" rx="3"/><path d="M14.5 3.5v17M14.5 12H21"/>' },
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
    if (z === 'settings') return document.querySelectorAll('#settings .set-row');
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
    { id: 'oled', name: 'Північ' },
    { id: 'forest', name: 'Карпати' },
    { id: 'paper', name: 'Папір' },
    { id: 'terminal', name: 'Термінал' },
  ];
  function themeId() { try { return localStorage.getItem('tv-theme') || 'lviv'; } catch (e) { return 'lviv'; } }
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
  var cities = [];
  getJSON('cities.json', function (err, c) { if (!err) cities = c; });
  function openSettings() {
    loadApps();
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
    if (kind === 'bg') {
      var bi = BG_CHOICES.indexOf(bgChoice());
      var nb = BG_CHOICES[(bi + (dir || 1) + BG_CHOICES.length) % BG_CHOICES.length];
      try { localStorage.setItem('tv-bg', nb); } catch (e) {}
      bgPhase = null; paintBackground();
      $('set-bg').textContent = bgName();
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
      var c = cities[(i + (dir || 1) + cities.length) % cities.length];
      if (TV && TV.setCity) TV.setCity(JSON.stringify(c));
      data = data || {}; data.cityInfo = c; data.city = c.name;
      homeKey = ''; $('set-city').textContent = c.name;
      setTimeout(poll, 600); setTimeout(poll, 3000);
    } else if (kind === 'layout') {
      stepLayout(dir || 1);
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
  document.addEventListener('keydown', function (e) {
    var k = e.key || '';
    var code = e.keyCode;
    var list = items(zone);
    var before = zone + ':' + idx[zone];
    if (zone === 'settings') {
      var r = settingsKey(k, code);
      if (!r) return;
      e.preventDefault();
      render();
      SOUND[r === 'move' ? 'move' : r]();
      return;
    }
    if (k === 'ArrowRight' || code === 22) idx[zone]++;
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
  function bgChoice() { try { return localStorage.getItem('tv-bg') || 'city'; } catch (e) { return 'city'; } }
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
    $('pl-app').textContent = m.live ? (m.app || 'плеєр') : 'продовжити · ' + (m.app || '');
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
    try { var v = localStorage.getItem('tv-layout') || 'classic'; return v === 'big' ? 'classic' : v; } catch (e) { return 'classic'; }
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
  window.tvResume = function () {
    loadApps(); buildDock();
    if (!$('drawer').hidden) closeDrawer();
    zone = 'dock'; render(); poll(); paintWifi(); pollMedia();
  };
  // Called by the launcher with Back while the drawer is open.
  window.tvBack = function () {
    if (!$('drawer').hidden) { SOUND.back(); closeDrawer(); return true; }
    if (!$('settings').hidden) { SOUND.back(); closeSettings(); return true; }
    return false;
  };

  loadApps(); buildDock(); render();
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
