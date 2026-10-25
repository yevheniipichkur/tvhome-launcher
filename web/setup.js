// Settings (sections on the left, rows with icons/descriptions on the right, the live screen beside
// them), quick settings from the shelf, notch-style toasts, and the first-run wizard (live preview,
// city by IP, shelf picker, power queue + team, home screen, permissions, tips). The actual setting
// changes reuse app.js (window.TVH.act → settingsAct), so behaviour stays the same as before.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var H = function () { return window.TVH || {}; };
  var TV = window.TV || null;
  var lite = !!(TV && TV.isLite && TV.isLite());
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function snd(k) { var S = H().SOUND; if (S && S[k]) S[k](); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var IC = {
    cinema: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/>',
    screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    shelf: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    data: '<path d="M7 18a5 5 0 1 1 1.6-9.7A6 6 0 0 1 20 11a4 4 0 0 1-1 7.9z"/>',
    system: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    editor: '<path d="M3 21h6l11-11a3 3 0 0 0-6-6L3 15z"/><path d="m13 5 6 6"/>',
    theme: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="16" cy="10" r="1.3"/><path d="M12 21a3 3 0 0 1 0-6h3"/>',
    bg: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M14 12h7"/>',
    season: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    bgdim: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
    wizard: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    maplayer: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    map3d: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"/>',
    notchmap: '<path d="M6 17h12l-1.5-2V11a4.5 4.5 0 0 0-9 0v4z"/><path d="M10 20h4"/>',
    city: '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    powerq: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    team: '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10z"/>',
    speed: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-6"/>',
    freemem: '<path d="M19 3 9 13"/><path d="M6 14l4 4-3 3H3v-4z"/>',
    volui: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    sounds: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    perms: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    update: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    android: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    wifi: '<path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.9a10 10 0 0 1 14 0"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
    home: '<path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/>',
    bell: '<path d="M6 17h12l-1.5-2V11a4.5 4.5 0 0 0-9 0v4z"/><path d="M10 20h4"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    hold: '<rect x="7" y="3" width="10" height="18" rx="5"/><circle cx="12" cy="10" r="2.2"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    remote: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    adb: '<path d="M4 17l6-6-6-6M12 19h8"/>',
    kbd: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    adbctl: '<path d="M4 17l6-6-6-6M12 19h8"/>',
    quick: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
  };
  function ic(name) { return '<svg viewBox="0 0 24 24">' + (IC[name] || '') + '</svg>'; }

  // ---------- notch toast ----------
  var toastT = null;
  function toast(icon, text, sub) {
    var t = $('toast');
    if (!t) return;
    t.innerHTML = '<span class="ti">' + ic(icon) + '</span><span class="tt"><b>' + esc(text) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>';
    t.hidden = false;
    t.offsetWidth; // restart the drop-in
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('show'); setTimeout(function () { if (!t.classList.contains('show')) t.hidden = true; }, 400); }, 2800);
  }

  // ---------- values shared by settings and quick settings ----------
  function legacy(id) { var e = $('set-' + id); return e ? e.textContent : ''; }
  function bgDim() { var v = +(ls('tv-bgdim') || 0); return isNaN(v) ? 0 : v; }
  function applyBgDim() { document.body.style.setProperty('--bgdim', String(bgDim() / 100)); }
  applyBgDim();
  function vol() { try { return JSON.parse(TV.volume()); } catch (e) { return null; } }

  var ROWS = {
    cinema: { name: 'Кіновечір удвох', desc: 'оберіть спільний фільм із двох телефонів', type: 'act' },
    editor: { name: 'Конструктор екрана', desc: 'блоки, кольори, годинник, шрифт, полиця', type: 'act' },
    theme: { name: 'Тема', desc: 'кольори й настрій усього екрана', type: 'opt', val: function () { return legacy('theme'); }, pos: function () { var l = H().THEMES(), c = H().themeId(); return [idxOf(l, function (t) { return t.id === c; }), l.length]; } },
    bg: { name: 'Фон', desc: 'живі світи, мапа міста або градієнт', type: 'opt', val: function () { return legacy('bg'); }, pos: function () { var l = H().BG_CHOICES(); return [l.indexOf(H().bgChoice()), l.length]; } },
    layout: { name: 'Макет', desc: 'де годинник, де карта', type: 'opt', val: function () { return legacy('layout'); }, pos: function () { var l = H().LAYOUTS(), c = H().layoutId(); return [idxOf(l, function (x) { return x.id === c; }), l.length]; } },
    worldmotion: { name: 'Рух у живих світах', desc: 'легке світло та опади на фоні; вимкніть для статичного екрана', type: 'toggle', on: function () { return ls('tv-world-motion') !== '0'; } },
    bgdim: { name: 'Яскравість фону', desc: 'приглушити мапу чи градієнт під панелями', type: 'opt', val: function () { return (100 - bgDim()) + '%'; }, pos: function () { return [[0, 20, 40, 60].indexOf(bgDim()), 4]; } },
    season: { name: 'Святкове оформлення', desc: 'гірлянда на Новий рік, синьо-жовте у свята', type: 'toggle', on: function () { return H().seasonOn(); } },
    wizard: { name: 'Пройти налаштування знову', desc: 'місто, полиця, дозволи — з самого початку', type: 'act' },
    maplayer: { name: 'Шар карти', desc: 'тривоги, лінія фронту або погода', type: 'opt', val: function () { return legacy('maplayer'); }, pos: function () { var l = H().MAP_LAYERS(); return [l.indexOf(H().mapLayer()), l.length]; } },
    map3d: { name: 'Карта в перспективі', desc: 'легкий нахил, як погляд згори', type: 'toggle', on: function () { return H().map3d(); } },
    notchmap: { name: 'Карта в сповіщенні про тривогу', desc: 'маленька карта в «чубчику» поверх фільму', type: 'toggle', full: true, on: function () { return !!(TV && TV.notchMap && TV.notchMap()); } },
    city: { name: 'Місто', desc: 'погода, тривоги «у моєму місті», мапа на фоні', type: 'opt', val: function () { return legacy('city'); }, pos: function () { var l = H().cities(), c = H().cityInfo().name; return [idxOf(l, function (x) { return x.name === c; }), l.length]; } },
    powerq: { name: 'Відключення світла', desc: 'графік вашої черги на головному екрані', type: 'opt', val: function () { return legacy('powerq'); }, pos: function () { var q = H().powerQueues(); return [q.indexOf(H().powerQueue()) + 1, q.length + 1]; } },
    team: { name: 'Футбол', desc: 'матчі в рядку новин і в блоці «Футбол»', type: 'opt', val: function () { return legacy('team'); }, pos: function () { var l = H().TEAMS(), c = ls('tv-team') || ''; return [idxOf(l, function (t) { return t[0] === c; }), l.length]; } },
    speed: { name: 'Швидкість інтернету', desc: 'завантаження й пінг (Cloudflare)', type: 'act', val: function () { return legacy('net'); } },
    freemem: { name: 'Звільнити пам’ять', desc: 'закрити фонові програми, якщо приставка гальмує', type: 'act', val: function () { return lastFree || ''; } },
    volui: { name: 'Панель гучності «Вітальні»', desc: 'єдина шкала на ТВ і в пульті; поверх програм потрібна служба «Вітальня»', type: 'toggle', full: true, on: function () { return !!(TV && TV.pref && TV.pref('vol_ui')); } },
    volumekeys: { name: 'Звичайний пульт: панель гучності', desc: 'Перевірте службу «Вітальня»; інша служба може забирати кнопки', type: 'act', full: true, val: function () {
      try { var v = JSON.parse(TV.volumeSupport()); if (!v.uiEnabled) return 'Панель вимкнена'; if (!v.connected) return 'Увімкніть службу'; if (v.otherKeyFilters && v.otherKeyFilters.length) return 'Можливий конфлікт служб'; return v.filterRequested && v.filterCapable ? 'Служба підключена' : 'Перезапустіть службу'; } catch (e) { return 'Відкрити перевірку'; }
    } },
    sounds: { name: 'Звуки меню', desc: 'тихе клацання при русі по меню', type: 'toggle', on: function () { return ls('tv-sounds') !== '0'; } },
    perms: { name: 'Дозволи', desc: 'головний екран, спецможливості, сповіщення', type: 'act', val: function () { var p = permState(), ok = p.filter(function (x) { return x.ok; }).length; return ok + ' з ' + p.length; } },
    update: { name: 'Оновлення', desc: 'нові версії з tvhome.pichkur.com', type: 'act', val: function () { return legacy('update'); } },
    kbd: { name: 'Клавіатура з телефону', desc: 'текст із телефону потрапляє в будь-яке поле на телевізорі', type: 'act', val: function () { var r = rinfo(); return r.imeCurrent ? 'увімкнено' : r.imeEnabled ? 'ОК — вибрати' : 'ОК — увімкнути'; } },
    adbctl: { name: 'Стрілки в усіх програмах', desc: 'керувати YouTube, Lampa тощо з телефону (через налагодження по мережі)', type: 'act', val: function () { var a = rinfo().adb; return a === 'ok' ? 'працює' : a === 'asking' ? 'підтвердьте на екрані' : a === 'off' ? 'налагодження вимкнено' : 'ОК — перевірити'; } },
    android: { name: 'Налаштування Android', desc: 'мережа, звук, екран, програми', type: 'act' },
  };
  var SECTIONS = [
    { id: 'screen', name: 'Екран', rows: ['editor', 'theme', 'bg', 'worldmotion', 'layout', 'bgdim', 'season', 'wizard'] },
    { id: 'map', name: 'Карта', side: 'left', rows: ['maplayer', 'map3d', 'notchmap'] },
    { id: 'shelf', name: 'Полиця', apps: true },
    { id: 'data', name: 'Дані', rows: ['city', 'powerq', 'team'] },
    { id: 'phone', name: 'Телефон', rows: ['cinema', 'kbd', 'adbctl'], remote: true },
    { id: 'system', name: 'Система', rows: ['speed', 'freemem', 'volui', 'volumekeys', 'sounds', 'perms', 'update', 'android'], about: true },
  ];
  function idxOf(list, f) { for (var i = 0; i < list.length; i++) if (f(list[i])) return i; return 0; }
  function rowVisible(k) { var r = ROWS[k]; if (r.full && (lite || !TV)) return false; if (k === 'volui') { var v = vol(); if (v && v.fixed) return false; } return true; }

  // ---------- settings ----------
  var st = { open: false, sec: 0, area: 'nav', i: 0 };
  var lastFree = '';
  function open() {
    if (H().renderLegacy) H().renderLegacy();
    st.open = true; st.area = 'nav'; st.i = 0;
    $('settings').hidden = false;
    document.body.classList.add('settings-open');
    renderSettings();
  }
  function close() {
    st.open = false;
    document.body.classList.remove('settings-open');
    if (H().closeSettings) H().closeSettings(); else $('settings').hidden = true;
  }
  function rowsOf(sec) {
    if (sec.apps) {
      var list = H().dockList(), apps = H().apps().slice(), by = {};
      apps.forEach(function (a) { by[a.pkg] = a; });
      var on = list.filter(function (p) { return by[p]; }).map(function (p) { return by[p]; });
      var off = apps.filter(function (a) { return list.indexOf(a.pkg) < 0; }).sort(function (x, y) { return x.label.localeCompare(y.label, 'uk'); });
      return on.concat(off).map(function (a) { return { app: a, n: list.indexOf(a.pkg) + 1 }; });
    }
    return sec.rows.filter(rowVisible).map(function (k) { return { k: k }; });
  }
  function dots(p) {
    if (!p || p[1] < 2) return '';
    if (p[1] > 8) return '<span class="cnt">' + (p[0] + 1) + ' / ' + p[1] + '</span>';
    var h = '<span class="dots">';
    for (var i = 0; i < p[1]; i++) h += '<i' + (i === p[0] ? ' class="on"' : '') + '></i>';
    return h + '</span>';
  }
  function rowHtml(r, focus) {
    if (r.app) {
      var a = r.app, pic = a.icon || a.banner || '';
      return '<div class="sv-row app' + (focus ? ' focus' : '') + (r.n ? ' on' : '') + '"><span class="ic pic"' + (pic ? ' style="background-image:url(' + pic + ')"' : '') + '></span>' +
        '<span class="tx"><b>' + esc(a.label) + '</b><small>' + (r.n ? 'на полиці · місце ' + r.n + ' · ◀ ▶ — пересунути' : 'сховано · ОК — додати на полицю') + '</small></span>' +
        '<span class="sw' + (r.n ? ' on' : '') + '"></span></div>';
    }
    var d = ROWS[r.k], right = '';
    if (d.type === 'toggle') right = '<span class="sw' + (d.on() ? ' on' : '') + '"></span>';
    else if (d.type === 'opt') right = '<span class="val"><b>' + esc(d.val()) + '</b>' + dots(d.pos && d.pos()) + '</span><span class="arr">◀ ▶</span>';
    else right = '<span class="val"><b>' + esc(d.val ? d.val() : '') + '</b></span><span class="arr">›</span>';
    return '<div class="sv-row' + (focus ? ' focus' : '') + '"><span class="ic">' + ic(r.k) + '</span><span class="tx"><b>' + esc(d.name) + '</b><small>' + esc(d.desc) + '</small></span>' + right + '</div>';
  }
  var aboutT = null;
  function aboutHtml() {
    var d = {};
    try { d = JSON.parse(TV.deviceInfo()); } catch (e) { return ''; }
    var gb = function (b) { return (b / 1073741824).toFixed(b > 10737418240 ? 0 : 1) + ' ГБ'; };
    var up = Math.floor((d.uptime || 0) / 60000), upTxt = up > 1440 ? Math.floor(up / 1440) + ' д ' + Math.floor(up % 1440 / 60) + ' год' : Math.floor(up / 60) + ' год ' + up % 60 + ' хв';
    var bar = function (used, total) { var p = total ? Math.round(used / total * 100) : 0; return '<i class="bar"><em style="width:' + p + '%"></em></i>'; };
    var cells = [
      ['Приставка', esc(d.model || '—')], ['Android', esc(d.android || '—')],
      ['Пам’ять', gb(d.ramTotal - d.ramFree) + ' з ' + gb(d.ramTotal) + bar(d.ramTotal - d.ramFree, d.ramTotal)],
      ['Сховище', 'вільно ' + gb(d.diskFree) + ' з ' + gb(d.diskTotal) + bar(d.diskTotal - d.diskFree, d.diskTotal)],
      ['Процесор', d.temp > 0 ? Math.round(d.temp) + ' °C' : '—'], ['Працює', upTxt],
      ['IP у мережі', esc(d.ip || '—')], ['«Вітальня»', 'версія ' + esc(d.version || '')],
    ];
    return '<div class="sv-about"><div class="sv-h">Про приставку</div><div class="sv-grid">' + cells.map(function (c) { return '<div><small>' + c[0] + '</small><b>' + c[1] + '</b></div>'; }).join('') + '</div></div>';
  }
  function rinfo() { try { return JSON.parse(TV.remoteInfo()); } catch (e) { return {}; } }
  function qrSvg(text) {
    try {
      var qr = qrcode(0, 'M'); qr.addData(text); qr.make();
      var n = qr.getModuleCount(), d = '';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (qr.isDark(y, x)) d += 'M' + x + ' ' + y + 'h1v1h-1z';
      return '<svg viewBox="-2 -2 ' + (n + 4) + ' ' + (n + 4) + '" class="qr"><rect x="-2" y="-2" width="' + (n + 4) + '" height="' + (n + 4) + '" fill="#fff"/><path d="' + d + '" fill="#0b1017"/></svg>';
    } catch (e) { return ''; }
  }
  function remoteHtml() {
    var r = TV && TV.remoteInfo ? rinfo() : { url: 'http://192.168.1.18:8765/?pin=000000', ip: '192.168.1.18', port: 8765, pin: '000000' };
    if (!r.url) return '<div class="sv-about"><div class="sv-h">Пульт з телефону</div><b>Немає мережі — підключіть приставку до Wi‑Fi</b></div>';
    return '<div class="sv-remote">' + qrSvg(r.url) + '<div class="rm-t"><div class="sv-h">Пульт з телефону</div>' +
      '<p>Наведіть камеру телефону на код — або відкрийте в браузері телефону:</p>' +
      '<b class="rm-url">' + esc(r.ip) + ':' + r.port + '</b><p>код <b class="rm-pin">' + esc(String(r.pin).replace(/(\d{3})(\d{3})/, '$1 $2')) + '</b></p>' +
      '<small>Телефон і приставка мають бути в одній мережі Wi‑Fi. Додайте сторінку на головний екран телефону — вийде окремий застосунок.</small></div></div>';
  }
  function renderSettings() {
    if (!st.open) return;
    var sec = SECTIONS[st.sec], rows = rowsOf(sec);
    st.i = Math.max(0, Math.min(st.i, rows.length - 1));
    var mirror = document.body.classList.contains('layout-mirror');
    $('settings').classList.toggle('sv-left', !!sec.side !== mirror);
    $('sv-nav').innerHTML = '<div class="sv-brand">Налаштування</div>' + SECTIONS.map(function (s, i) {
      return '<div class="sv-nav-i' + (i === st.sec ? ' sel' : '') + (i === st.sec && st.area === 'nav' ? ' focus' : '') + '">' + ic(s.id) + '<span>' + s.name + '</span></div>';
    }).join('') + '<div class="sv-hint">▲ ▼ розділ · ▶ або ОК — увійти<br>Назад — закрити</div>';
    $('sv-title').innerHTML = esc(sec.name) + (sec.apps ? '<small>ОК — показати чи сховати · ◀ ▶ — порядок на полиці</small>' : '<small>▲ ▼ вибір · ◀ ▶ змінити · ОК · Назад — до розділів</small>');
    $('sv-rows').innerHTML = (sec.remote ? remoteHtml() : '') + rows.map(function (r, i) { return rowHtml(r, st.area === 'rows' && i === st.i); }).join('') + (sec.about && TV ? aboutHtml() : '');
    var f = $('sv-rows').querySelector('.focus');
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
    clearTimeout(aboutT);
    if ((sec.about || sec.remote) && TV) aboutT = setTimeout(renderSettings, sec.remote ? 2000 : 5000);
  }
  function settingsRowAct(dir) {
    var sec = SECTIONS[st.sec], rows = rowsOf(sec), r = rows[st.i];
    if (!r) return;
    if (r.app) {
      var list = H().dockList().slice(), at = list.indexOf(r.app.pkg);
      if (!dir) { if (at >= 0) list.splice(at, 1); else list.push(r.app.pkg); }
      else if (at >= 0) { var to = Math.max(0, Math.min(list.length - 1, at + dir)); list.splice(at, 1); list.splice(to, 0, r.app.pkg); }
      else return;
      H().saveDock(list);
      if (H().buildDock) H().buildDock();
      var nr = rowsOf(sec);
      for (var j = 0; j < nr.length; j++) if (nr[j].app.pkg === r.app.pkg) st.i = j;
      renderSettings();
      return;
    }
    var k = r.k, d = ROWS[k];
    if (d.type === 'opt') {
      if (!dir) dir = 1;
      if (k === 'bgdim') { var l = [0, 20, 40, 60]; ls('tv-bgdim', String(l[(l.indexOf(bgDim()) + dir + 4) % 4])); applyBgDim(); }
      else H().act(k, dir);
    } else if (d.type === 'toggle') {
      if (k === 'worldmotion') { ls('tv-world-motion', ls('tv-world-motion') === '0' ? '1' : '0'); if (window.Cinema) Cinema.motion(); }
      else if (k === 'volui') TV.setPref('vol_ui', !TV.pref('vol_ui'));
      else if (k === 'sounds') ls('tv-sounds', ls('tv-sounds') === '0' ? '1' : '0');
      else H().act(k, 0);
    } else {
      if (dir) { if (dir < 0) { st.area = 'nav'; renderSettings(); } return; }
      if (k === 'cinema') { close(); if (window.Cinema) Cinema.openTV(); return; }
      if (k === 'editor') { close(); if (window.TVC) TVC.open(); return; }
      if (k === 'wizard') { close(); wizard(); return; }
      if (k === 'perms') { close(); wizard('perms'); return; }
      if (k === 'volumekeys') TV.openSettings('accessibility');
      else if (k === 'kbd') { kbdSetup(); }
      else if (k === 'adbctl') { if (TV && TV.adbProbe) TV.adbProbe(); toast('adb', 'Перевіряю налагодження', 'якщо з’явиться «Дозволити налагодження?» — «Завжди» й «ОК»'); }
      else if (k === 'freemem') { freeMem(); }
      else if (k === 'speed') { H().act('speed', 0); var n = 0, iv = setInterval(function () { renderSettings(); if (++n > 30 || !/вимірюю/.test(legacy('net'))) { clearInterval(iv); renderSettings(); if (!/не вдалося/.test(legacy('net'))) toast('speed', 'Швидкість інтернету', legacy('net')); } }, 700); }
      else H().act(k, 0);
    }
    if (H().renderLegacy) H().renderLegacy();
    renderSettings();
    setTimeout(function () { if (H().renderLegacy) H().renderLegacy(); renderSettings(); }, 400);
  }
  // the phone keyboard: make it current if the app may; otherwise enable it / pick it in Android
  function kbdSetup() {
    if (!TV) return;
    var r = rinfo();
    if (r.imeCurrent) { toast('keyboard', 'Клавіатура з телефону вже увімкнена'); return; }
    if (TV.useOurKeyboard && TV.useOurKeyboard()) { setTimeout(function () { if (rinfo().imeCurrent) toast('keyboard', 'Клавіатура з телефону увімкнена'); else if (!rinfo().imeEnabled) TV.openSettings('keyboard'); else TV.pickKeyboard(); }, 900); return; }
    if (!r.imeEnabled) { toast('keyboard', 'Увімкніть «Вітальня: клавіатура з телефону»', 'потім натисніть «Назад» — і ще раз ОК тут'); TV.openSettings('keyboard'); }
    else TV.pickKeyboard();
  }
  function freeMem() {
    if (!TV || !TV.freeMemory) return;
    lastFree = 'звільняю…'; renderSettings();
    setTimeout(function () {
      var r = {};
      try { r = JSON.parse(TV.freeMemory()); } catch (e) {}
      var mb = function (b) { return Math.round(b / 1048576); };
      var got = Math.max(0, mb(r.after - r.before));
      lastFree = 'вільно ' + mb(r.after) + ' МБ' + (got ? ' (+' + got + ')' : '');
      toast('freemem', got ? 'Звільнено ' + got + ' МБ' : 'Пам’ять уже вільна', 'вільно ' + mb(r.after) + ' МБ з ' + mb(r.total));
      renderSettings();
    }, 50);
  }
  function settingsKey(k) {
    var sec = SECTIONS[st.sec], n = rowsOf(sec).length;
    if (st.area === 'nav') {
      if (k === 'up') { st.sec = Math.max(0, st.sec - 1); st.i = 0; snd('move'); }
      else if (k === 'down') { st.sec = Math.min(SECTIONS.length - 1, st.sec + 1); st.i = 0; snd('move'); }
      else if ((k === 'right' || k === 'ok') && n) { st.area = 'rows'; st.i = 0; snd('open'); }
      else if (k === 'back') { close(); snd('back'); return; }
      else return;
    } else {
      if (k === 'up') { if (st.i === 0) st.area = 'nav'; else st.i--; snd('move'); }
      else if (k === 'down') { st.i = Math.min(n - 1, st.i + 1); snd('move'); }
      else if (k === 'left' || k === 'right') { settingsRowAct(k === 'right' ? 1 : -1); snd('move'); return; }
      else if (k === 'ok') { settingsRowAct(0); snd('open'); return; }
      else if (k === 'back') { st.area = 'nav'; snd('back'); }
      else return;
    }
    renderSettings();
  }

  // ---------- quick settings (button on the shelf) ----------
  var qk = { open: false, i: 0 };
  function qRows() {
    var r = [];
    var v = TV && TV.volume ? vol() : null;
    if (v && !v.fixed) r.push({ k: 'vol', name: 'Гучність', type: 'opt', val: function () { var x = vol(); return x ? (x.muted ? 'Без звуку' : Math.round(100 * x.cur / Math.max(1, x.max)) + '%') : ''; }, bar: function () { var x = vol(); return x ? (x.muted ? 0 : x.cur / Math.max(1, x.max)) : 0; } });
    r.push({ k: 'maplayer' }, { k: 'layout' }, { k: 'theme' }, { k: 'bgdim' }, { k: 'sounds' });
    var w = H().wifi ? H().wifi() : null;
    r.push({ k: 'wifi', name: 'Мережа', type: 'act', val: function () { return w ? (w.type === 'ethernet' ? 'Ethernet' : w.ssid || 'Wi‑Fi') : ''; } });
    r.push({ k: 'phone', name: 'Пульт з телефону', type: 'act', val: function () { var x = TV && TV.remoteInfo ? rinfo() : {}; return x.ip ? x.ip + ':' + x.port : ''; } });
    r.push({ k: 'editor' }, { k: 'all', name: 'Усі налаштування', type: 'act', val: function () { return ''; } });
    return r;
  }
  function quick() {
    if (H().renderLegacy) H().renderLegacy();
    qk.open = true; qk.i = 0; $('quick').hidden = false; renderQuick();
  }
  function quickClose() { qk.open = false; $('quick').hidden = true; if (H().zoneDock) H().zoneDock(); }
  function renderQuick() {
    var rows = qRows();
    qk.i = Math.max(0, Math.min(qk.i, rows.length - 1));
    $('quick').innerHTML = '<div class="qk-h">' + ic('quick') + 'Швидкі налаштування</div>' + rows.map(function (r, i) {
      var d = ROWS[r.k] || r, name = r.name || d.name, right;
      if (d.type === 'toggle') right = '<span class="sw' + (d.on() ? ' on' : '') + '"></span>';
      else if (r.bar) right = '<span class="qbar"><em style="width:' + Math.round(r.bar() * 100) + '%"></em></span><b>' + esc(r.val()) + '</b>';
      else right = '<b>' + esc(d.val ? d.val() : '') + '</b>' + (d.type === 'opt' ? '<span class="arr">◀ ▶</span>' : '<span class="arr">›</span>');
      return '<div class="qk-row' + (i === qk.i ? ' focus' : '') + '"><span class="ic">' + ic(r.k === 'vol' ? 'volui' : r.k === 'all' ? 'android' : r.k) + '</span><span class="nm">' + esc(name) + '</span>' + right + '</div>';
    }).join('');
  }
  function quickAct(dir) {
    var r = qRows()[qk.i];
    if (!r) return;
    if (r.k === 'vol') { var v = vol(); if (v) { TV.setVolume(v.cur + (dir || 1));  } }
    else if (r.k === 'wifi') { if (!dir) { quickClose(); TV && TV.openSettings && TV.openSettings('wifi'); } return; }
    else if (r.k === 'editor') { if (!dir) { quickClose(); if (window.TVC) TVC.open(); } return; }
    else if (r.k === 'phone') { if (!dir) { quickClose(); open(); st.sec = idxOf(SECTIONS, function (x) { return x.id === 'phone'; }); renderSettings(); } return; }
    else if (r.k === 'all') { if (!dir) { quickClose(); open(); } return; }
    else if (r.k === 'bgdim') { var l = [0, 20, 40, 60]; ls('tv-bgdim', String(l[(l.indexOf(bgDim()) + (dir || 1) + 4) % 4])); applyBgDim(); }
    else if (r.k === 'sounds') ls('tv-sounds', ls('tv-sounds') === '0' ? '1' : '0');
    else H().act(r.k, dir || 1);
    if (H().renderLegacy) H().renderLegacy();
    renderQuick();
    setTimeout(function () { if (H().renderLegacy) H().renderLegacy(); if (qk.open) renderQuick(); }, 400);
  }
  function quickKey(k) {
    var n = qRows().length;
    if (k === 'up') { qk.i = Math.max(0, qk.i - 1); snd('move'); }
    else if (k === 'down') { qk.i = Math.min(n - 1, qk.i + 1); snd('move'); }
    else if (k === 'left' || k === 'right') { quickAct(k === 'right' ? 1 : -1); snd('move'); return; }
    else if (k === 'ok') { quickAct(0); snd('open'); return; }
    else if (k === 'back') { quickClose(); snd('back'); return; }
    renderQuick();
  }

  // ---------- permissions ----------
  function permState() {
    var p = [];
    if (!TV) return p;
    p.push({ k: 'home', name: 'Головний екран', desc: 'кнопка «Додому» на пульті відкриває «Вітальню»', ok: !!(TV.isDefaultHome && TV.isDefaultHome()) || (!lite && !!(TV.a11yEnabled && TV.a11yEnabled())) });
    if (!lite) {
      p.push({ k: 'a11y', name: 'Спеціальні можливості', desc: 'кнопки звичайного пульта, наша панель гучності й тривоги поверх програм', ok: !!(TV.a11yEnabled && TV.a11yEnabled()) });
      p.push({ k: 'kbd', name: 'Клавіатура з телефону', desc: 'писати з телефону в будь-якому полі на телевізорі', ok: !!rinfo().imeCurrent });
      p.push({ k: 'notif', name: 'Доступ до сповіщень', desc: 'назва треку й кнопки в міні-плеєрі', ok: !!(TV.notifAccess && TV.notifAccess()) });
    }
    return p;
  }
  function permAct(k) {
    if (k === 'home') { if (TV.chooseHome) TV.chooseHome(); wz.homeTried = true; }
    else if (k === 'a11y') TV.openSettings('accessibility');
    else if (k === 'notif') TV.openSettings('notifications');
    else if (k === 'kbd') kbdSetup();
  }

  // ---------- wizard ----------
  var wz = { open: false, steps: [], step: 0, i: 0, det: null, homeTried: false };
  function wizard(only) {
    var steps = only === 'perms' ? ['perms'] : ['welcome', 'city', 'shelf', 'data'];
    if (!only && TV && TV.isDefaultHome && !TV.isDefaultHome()) steps.push('home');
    if (!only && TV && !lite) steps.push('perms');
    if (!only) steps.push('tips');
    wz.steps = steps; wz.step = 0; wz.i = 0; wz.only = only; wz.open = true; wz.homeTried = false;
    // the shelf: the known players that are installed, unless one was already chosen
    if (!only && !ls('tv-dock')) {
      var have = {}; H().apps().forEach(function (a) { have[a.pkg] = 1; });
      var pick = ['top.rootu.lamps', 'com.google.android.youtube.tv', 'com.netflix.ninja', 'com.megogo.application', 'studio.scillarium.ottnavigator', 'com.spotify.tv.android', 'org.videolan.vlc']
        .filter(function (p) { return have[p]; });
      if (pick.length < 3) pick = H().apps().slice(0, 6).map(function (a) { return a.pkg; });
      H().saveDock(pick.slice(0, 6)); if (H().buildDock) H().buildDock();
    }
    $('wz2').hidden = false;
    document.body.classList.add('wizard-open');
    renderWz();
  }
  function wzClose(done) {
    wz.open = false; $('wz2').hidden = true;
    document.body.classList.remove('wizard-open');
    if (done && !wz.only) { ls('tv-setup-done', '1'); toast('check', 'Готово!', 'Затисніть ОК на програмі — меню програми'); }
    if (H().zoneDock) H().zoneDock();
  }
  function detectCity() {
    if (wz.det !== null) return;
    wz.det = false;
    var done = function (lat, lon) {
      var list = H().cities(), best = null, bd = 1e9;
      list.forEach(function (c) { var dx = (c.lon - lon) * Math.cos(lat * Math.PI / 180), dy = c.lat - lat, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } });
      if (best) { wz.det = { city: best, km: Math.round(Math.sqrt(bd) * 111) }; if (wz.open && wz.steps[wz.step] === 'city') renderWz(); }
    };
    var tryNext = function (urls) {
      if (!urls.length) return;
      fetch(urls[0], { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        var lat = j.latitude != null ? j.latitude : j.lat, lon = j.longitude != null ? j.longitude : j.lon;
        if (typeof lat === 'number' && typeof lon === 'number') done(lat, lon); else tryNext(urls.slice(1));
      }).catch(function () { tryNext(urls.slice(1)); });
    };
    tryNext(['https://ipapi.co/json/', 'https://ipwho.is/']);
  }
  function wzRows() {
    var s = wz.steps[wz.step], r = [];
    if (s === 'welcome') r.push({ k: 'next', name: 'Почати', main: true });
    if (s === 'city') {
      var cur = H().cityInfo().name;
      if (wz.det && wz.det.city.name !== cur) r.push({ k: 'det', name: 'Так, моє місто — ' + wz.det.city.name, main: true });
      r.push({ k: 'city', name: 'Місто', opt: true, val: cur, sub: 'погода, тривоги, мапа на фоні' });
      r.push({ k: 'next', name: 'Далі', main: !(wz.det && wz.det.city.name !== cur) });
    }
    if (s === 'shelf') {
      var list = H().dockList(), apps = H().apps().slice().sort(function (a, b) { return (b.tv ? 1 : 0) - (a.tv ? 1 : 0) || a.label.localeCompare(b.label, 'uk'); });
      apps.forEach(function (a) { r.push({ k: 'app', app: a, on: list.indexOf(a.pkg) >= 0 }); });
      r.push({ k: 'next', name: 'Далі', main: true });
    }
    if (s === 'data') {
      if (H().powerRegion()) r.push({ k: 'powerq', name: 'Відключення світла', opt: true, val: legacy('powerq') || 'не показувати', sub: 'оберіть свою чергу — графік з’явиться на головному' });
      else r.push({ k: 'none', name: 'Відключення світла', val: 'для вашої області даних немає', sub: '' });
      r.push({ k: 'team', name: 'Футбол', opt: true, val: legacy('team') || 'не показувати', sub: 'матчі команди в рядку новин' });
      r.push({ k: 'next', name: 'Далі', main: true });
    }
    if (s === 'home') {
      var isHome = TV && TV.isDefaultHome && TV.isDefaultHome();
      if (!isHome) r.push({ k: 'choose', name: 'Зробити «Вітальню» головною', main: !wz.homeTried });
      r.push({ k: 'next', name: isHome ? 'Далі' : wz.homeTried ? 'Далі' : 'Пропустити', main: isHome || wz.homeTried });
    }
    if (s === 'perms') {
      permState().forEach(function (p) { r.push({ k: 'perm', p: p }); });
      r.push({ k: 'next', name: wz.only ? 'Готово' : 'Далі', main: true });
    }
    if (s === 'tips') r.push({ k: 'next', name: 'Почати користуватися', main: true });
    return r;
  }
  var STEP_TEXT = {
    welcome: ['Вітаю у «Вітальні»', 'Головний екран для телевізора. Налаштуємо за хвилину — а все, що змінюєте, видно одразу ліворуч.'],
    city: ['Ваше місто', 'Від міста залежать погода, схід сонця, тривоги «у моєму місті», мапа вулиць на фоні та графік світла.'],
    shelf: ['Полиця програм', 'Позначте програми, які будуть унизу екрана. Порядок і решту можна змінити потім: затисніть ОК на програмі.'],
    data: ['Світло й футбол', 'Необов’язково — можна пропустити й увімкнути пізніше в Налаштуваннях → Дані.'],
    home: ['Головний екран', ''],
    perms: ['Дозволи', 'Кожен дозвіл вмикає щось конкретне. ОК на рядку відкриє потрібне місце в налаштуваннях Android, а «Назад» на пульті поверне сюди.'],
    tips: ['Три речі, які варто знати', ''],
  };
  function renderWz() {
    if (!wz.open) return;
    var s = wz.steps[wz.step], rows = wzRows();
    if (s === 'city') detectCity();
    wz.i = Math.max(0, Math.min(wz.i, rows.length - 1));
    var t = STEP_TEXT[s], h = '';
    if (wz.steps.length > 1) h += '<div class="wz-dots">' + wz.steps.map(function (x, i) { return '<i class="' + (i === wz.step ? 'on' : i < wz.step ? 'done' : '') + '"></i>'; }).join('') + '<span>' + (wz.step + 1) + ' / ' + wz.steps.length + '</span></div>';
    h += '<h1>' + esc(t[0]) + '</h1>';
    if (s === 'home') {
      var isHome = TV && TV.isDefaultHome && TV.isDefaultHome();
      h += '<p>Головний екран — те, що відкривається кнопкою «Додому» на пульті й після ввімкнення приставки. Зараз це ' + (isHome ? '«Вітальня».' : 'стандартний екран приставки.') + '</p>';
      h += '<div class="wz-state ' + (isHome ? 'ok' : '') + '">' + ic(isHome ? 'check' : 'home') + (isHome ? '«Вітальня» — головний екран' : 'Ще не головний екран') + '</div>';
      if (!isHome && wz.homeTried) h += '<p class="wz-note">' + (lite
        ? 'Ця приставка не дає вибрати головний екран. Повна версія з <b>tvhome.pichkur.com</b> повертає кнопку «Додому» сама — або просто відкривайте «Вітальню» з полиці програм.'
        : 'Приставка не дала вибрати — нічого страшного: на наступному кроці ввімкніть «Вітальню» у Спеціальних можливостях, і кнопка «Додому» завжди відкриватиме її.') + '</p>';
      else if (!isHome) h += '<p class="wz-note">Після натискання з’явиться вибір програми: оберіть «Вітальня» і «Завжди». Якщо вибору не з’явиться — приставка цього не дозволяє, і ми покажемо інший спосіб.</p>';
    } else if (s === 'tips') {
      h += '<div class="wz-tips">' +
        '<div>' + ic('hold') + '<b>Затисніть ОК на програмі</b><small>відкрити, перемістити, прибрати з полиці, видалити</small></div>' +
        '<div>' + ic('quick') + '<b>Кнопка ' + '<i class="k">' + ic('quick') + '</i> на полиці</b><small>швидкі налаштування: гучність, карта, тема, яскравість</small></div>' +
        '<div>' + ic('editor') + '<b>Налаштування → Конструктор</b><small>зберіть свій екран: блоки, кольори, годинник, шрифт</small></div></div>';
    } else if (t[1]) h += '<p>' + esc(t[1]) + '</p>';
    if (s === 'welcome') h += '<div class="wz-feats"><div>' + ic('bell') + 'Тривоги й цілі в небі в реальному часі</div><div>' + ic('map') + 'Карта, лінія фронту, погода над Україною</div><div>' + ic('powerq') + 'Світло, курси, новини, футбол</div><div>' + ic('shelf') + 'Ваші програми — на полиці внизу</div></div>';
    if (s === 'city' && wz.det) h += '<div class="wz-state ok">' + ic('city') + (wz.det.km > 150 ? 'Найближче до вас місто зі списку — ' : 'Схоже, ви в місті ') + esc(wz.det.city.name) + '</div>';
    if (s === 'shelf') { var c = H().dockList().length; h += '<div class="wz-count">на полиці: ' + c + '</div>'; }
    h += '<div class="wz-rows' + (s === 'shelf' ? ' scroll' : '') + '">' + rows.map(function (r, i) {
      var f = i === wz.i ? ' focus' : '';
      if (r.k === 'app') { var pic = r.app.icon || r.app.banner || ''; return '<div class="wz-row app' + f + '"><span class="ic pic"' + (pic ? ' style="background-image:url(' + pic + ')"' : '') + '></span><span class="nm">' + esc(r.app.label) + '</span><span class="sw' + (r.on ? ' on' : '') + '"></span></div>'; }
      if (r.k === 'perm') return '<div class="wz-row perm' + f + (r.p.ok ? ' ok' : '') + '"><span class="ic">' + ic(r.p.ok ? 'check' : r.p.k === 'home' ? 'home' : r.p.k === 'a11y' ? 'perms' : 'bell') + '</span><span class="tx"><b>' + esc(r.p.name) + '</b><small>' + esc(r.p.desc) + '</small></span><span class="val">' + (r.p.ok ? 'увімкнено' : 'ОК — увімкнути') + '</span></div>';
      if (r.opt || r.k === 'none') return '<div class="wz-row' + f + (r.k === 'none' ? ' dim' : '') + '"><span class="tx"><b>' + esc(r.name) + '</b>' + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</span><span class="val">' + esc(r.val) + '</span>' + (r.opt ? '<span class="arr">◀ ▶</span>' : '') + '</div>';
      return '<div class="wz-row btn' + f + (r.main ? ' main' : '') + '"><span class="nm">' + esc(r.name) + '</span><span class="arr">›</span></div>';
    }).join('') + '</div>';
    $('wz2-panel').innerHTML = h;
    var fe = $('wz2-panel').querySelector('.focus');
    if (fe && fe.scrollIntoView) fe.scrollIntoView({ block: 'nearest' });
  }
  function wzNext() {
    if (wz.step >= wz.steps.length - 1) { wzClose(true); return; }
    wz.step++; wz.i = 0; renderWz();
  }
  function wzAct(dir) {
    var rows = wzRows(), r = rows[wz.i];
    if (!r) return;
    if (r.opt) { H().act(r.k, dir || 1); setTimeout(function () { H().renderLegacy && H().renderLegacy(); renderWz(); }, 120); H().renderLegacy && H().renderLegacy(); renderWz(); return; }
    if (dir) return;
    if (r.k === 'next') return wzNext();
    if (r.k === 'det') { H().setCity(wz.det.city); setTimeout(wzNext, 150); return; }
    if (r.k === 'app') {
      var list = H().dockList().slice(), at = list.indexOf(r.app.pkg);
      if (at >= 0) list.splice(at, 1); else list.push(r.app.pkg);
      H().saveDock(list); if (H().buildDock) H().buildDock(); renderWz(); return;
    }
    if (r.k === 'choose') { permAct('home'); setTimeout(renderWz, 2500); renderWz(); return; }
    if (r.k === 'perm') { if (!r.p.ok) permAct(r.p.k); setTimeout(renderWz, 2500); return; }
  }
  function wzKey(k) {
    var n = wzRows().length;
    if (k === 'up') { wz.i = Math.max(0, wz.i - 1); snd('move'); }
    else if (k === 'down') { wz.i = Math.min(n - 1, wz.i + 1); snd('move'); }
    else if (k === 'left' || k === 'right') { wzAct(k === 'right' ? 1 : -1); snd('move'); return; }
    else if (k === 'ok') { wzAct(0); snd('open'); return; }
    else if (k === 'back') { if (wz.step > 0) { wz.step--; wz.i = 0; } else if (wz.only) { wzClose(false); return; } snd('back'); }
    else return;
    renderWz();
  }

  // ---------- slideshow of photos/videos sent from the phone ----------
  // Two image layers crossfade; each photo drifts slowly (a gentle Ken Burns), videos play to the end.
  var sl = { open: false, items: [], i: 0, t: null, paused: false, front: 'sl-a', capT: null };
  var KB = ['kb1', 'kb2', 'kb3', 'kb4'];
  function slideshow(items, start) {
    if (!items || !items.length) return;
    sl.items = items; sl.i = Math.max(0, Math.min(start || 0, items.length - 1)); sl.open = true; sl.paused = false;
    if (st.open) close(); if (qk.open) quickClose(); if (wz.open) wzClose(false);
    $('slides').hidden = false;
    document.body.classList.add('slides-open');
    showSlide();
  }
  function slideUrl(it) { return '/media/' + encodeURIComponent(it.file); }
  function showSlide() {
    clearTimeout(sl.t);
    var it = sl.items[sl.i], v = $('sl-v');
    $('sl-pause').classList.remove('on');
    if (it.kind === 'video') {
      ['sl-a', 'sl-b'].forEach(function (id) { $(id).classList.remove('on'); });
      v.src = slideUrl(it); v.classList.add('on'); v.currentTime = 0;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      v.onended = function () { nextSlide(1); };
    } else {
      v.pause(); v.removeAttribute('src'); v.load(); v.classList.remove('on');
      var back = sl.front === 'sl-a' ? 'sl-b' : 'sl-a', el = $(back);
      var img = new Image();
      img.onload = img.onerror = function () {
        el.style.backgroundImage = 'url("' + slideUrl(it) + '")';
        KB.forEach(function (k) { el.classList.remove(k); });
        void el.offsetWidth;
        el.classList.add('on', KB[Math.floor(Math.random() * KB.length)]);
        $(sl.front).classList.remove('on');
        sl.front = back;
        if (!sl.paused) sl.t = setTimeout(function () { nextSlide(1); }, 7000);
      };
      img.src = slideUrl(it);
    }
    var cap = $('sl-cap');
    cap.innerHTML = '<b>' + (sl.i + 1) + ' / ' + sl.items.length + '</b> · з телефону';
    cap.classList.add('on'); clearTimeout(sl.capT); sl.capT = setTimeout(function () { cap.classList.remove('on'); }, 3500);
  }
  function nextSlide(d) { sl.i = (sl.i + d + sl.items.length) % sl.items.length; showSlide(); }
  function slideClose() {
    clearTimeout(sl.t); sl.open = false;
    var v = $('sl-v'); v.pause(); v.removeAttribute('src'); v.load();
    $('slides').hidden = true; document.body.classList.remove('slides-open');
    if (H().zoneDock) H().zoneDock();
  }
  function slide(a) {
    if (!sl.open) return;
    if (a === 'next') nextSlide(1);
    else if (a === 'prev') nextSlide(-1);
    else if (a === 'close') slideClose();
    else if (a === 'pause') {
      sl.paused = !sl.paused;
      var v = $('sl-v'), it = sl.items[sl.i];
      if (it.kind === 'video') { if (sl.paused) v.pause(); else v.play(); }
      else if (sl.paused) clearTimeout(sl.t); else sl.t = setTimeout(function () { nextSlide(1); }, 3000);
      $('sl-pause').classList.toggle('on', sl.paused);
    }
  }
  function slideKey(k) {
    if (k === 'left') slide('prev'); else if (k === 'right') slide('next');
    else if (k === 'ok') slide('pause'); else if (k === 'back' || k === 'up' || k === 'down') slide('close');
  }

  // ---------- keys: settings / quick / wizard own the remote while open ----------
  function keyName(e) {
    var k = e.key || '', c = e.keyCode;
    if (k === 'ArrowUp' || c === 19) return 'up';
    if (k === 'ArrowDown' || c === 20) return 'down';
    if (k === 'ArrowLeft' || c === 21) return 'left';
    if (k === 'ArrowRight' || c === 22) return 'right';
    if (k === 'Enter' || c === 13 || c === 23) return 'ok';
    if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || c === 4 || c === 27) return 'back';
    return null;
  }
  function onKey(e) {
    if (!st.open && !qk.open && !wz.open && !sl.open) return;
    if (window.TVC && TVC.cfg && document.body.classList.contains('editing')) return;
    var k = keyName(e);
    if (!k) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type === 'keyup' || (e.repeat && k === 'ok')) return;
    if (sl.open) slideKey(k); else if (wz.open) wzKey(k); else if (qk.open) quickKey(k); else settingsKey(k);
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  var prevBack = window.tvBack;
  window.tvBack = function () {
    if (sl.open) { slideClose(); return true; }
    if (wz.open) { wzKey('back'); return true; }
    if (qk.open) { quickKey('back'); return true; }
    if (st.open) { settingsKey('back'); return true; }
    return prevBack ? prevBack() : false;
  };
  var prevResume = window.tvResume;
  window.tvResume = function () {
    // back from Android settings (permissions, home picker): refresh what we show
    if (wz.open) { setTimeout(renderWz, 300); setTimeout(renderWz, 1500); return; }
    if (st.open) { setTimeout(renderSettings, 300); return; }
    if (prevResume) prevResume();
  };

  // after an update: a short notch with the new version
  try {
    var u = TV && TV.updateInfo ? JSON.parse(TV.updateInfo()) : null, seen = ls('tv-seen-ver');
    if (u && u.name) {
      if (seen && seen !== u.name) setTimeout(function () { toast('update', 'Оновлено до версії ' + u.name, 'нові налаштування, теми й швидкі налаштування на полиці'); }, 4000);
      ls('tv-seen-ver', u.name);
    }
  } catch (e) {}

  window.TVS = { open: open, close: close, quick: quick, wizard: wizard, toast: toast, slideshow: slideshow, slide: slide };
})();
