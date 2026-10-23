// Screen builder («Конструктор екрана»): which blocks the left column shows and in what order, their
// size, extra blocks (week, football, front, countdown, note, photo of the day, second clock), what the
// right side shows, the shelf, accent colour, clock style, panels and font. Everything lives in one
// localStorage key; the editor is an overlay with its own key handling, so app.js only exposes a few
// hooks (window.TVH) and asks us about the clock and the shelf.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var H = function () { return window.TVH || {}; };
  var KEY = 'tv-screen';

  // ---------- blocks ----------
  var BLOCKS = {
    kicker: { name: 'Привітання і мережа', sel: '.left > .kicker' },
    hero: { name: 'Годинник і дата', sel: '.left > .hero' },
    arc: { name: 'Схід і захід сонця', sel: '.left > .arc' },
    weather: { name: 'Погода', sel: '.left > .weather' },
    status: { name: 'Тривога в місті', sel: '.left > .status' },
    power: { name: 'Відключення світла', sel: '.left > .power' },
    rates: { name: 'Курси НБУ', sel: '.left > .info-rates' },
    news: { name: 'Новини й футбол', sel: '.left > .info-news' },
    player: { name: 'Плеєр', sel: '.left > .player' },
    week: { name: 'Тиждень', extra: true },
    ball: { name: 'Футбол', extra: true, conf: true },
    front: { name: 'Фронт за добу', extra: true },
    countdown: { name: 'Відлік днів', extra: true, conf: true },
    note: { name: 'Нотатка', extra: true, conf: true },
    photo: { name: 'Фото дня', extra: true },
    tz2: { name: 'Другий годинник', extra: true, conf: true },
  };
  var BUILTIN = ['kicker', 'hero', 'arc', 'weather', 'status', 'power', 'rates', 'news', 'player'];
  var SIZES = ['s', 'm', 'l'], SIZE_NAME = { s: 'малий', m: 'звичайний', l: 'великий' };

  var OPTS = {
    right: { name: 'Права частина', values: ['map', 'clock', 'photo', 'calendar', 'none'], labels: { map: 'карта', clock: 'великий годинник', photo: 'фото дня', calendar: 'календар', none: 'нічого' } },
    mapSize: { name: 'Розмір карти', values: ['s', 'm', 'l'], labels: { s: 'менша', m: 'звичайна', l: 'більша' } },
    accent: { name: 'Колір акценту', values: ['', '#ff7a59', '#ff4f7b', '#d65cff', '#9b7bff', '#4f8bff', '#3cc8ff', '#2fd3c0', '#5fd38d', '#b6e04a', '#ffd84a', '#f1ece2'],
      labels: { '': 'як у темі', '#ff7a59': 'корал', '#ff4f7b': 'малина', '#d65cff': 'фуксія', '#9b7bff': 'бузок', '#4f8bff': 'синій', '#3cc8ff': 'блакить', '#2fd3c0': 'бірюза', '#5fd38d': 'м’ята', '#b6e04a': 'лайм', '#ffd84a': 'лимон', '#f1ece2': 'слонова кістка' } },
    clock: { name: 'Годинник', values: ['thin', 'bold', 'digital', 'analog', 'words'], labels: { thin: 'тонкий', bold: 'жирний', digital: 'табло', analog: 'стрілки', words: 'словами' } },
    font: { name: 'Шрифт', values: ['fixel', 'mono', 'serif', 'round'], labels: { fixel: 'Fixel', mono: 'моноширинний', serif: 'із засічками', round: 'округлий' } },
    panels: { name: 'Панелі', values: ['glass', 'solid', 'none'], labels: { glass: 'скло', solid: 'суцільні', none: 'без фону' } },
    radius: { name: 'Кути', values: ['round', 'soft', 'square'], labels: { round: 'круглі', soft: 'м’які', square: 'прямі' } },
    border: { name: 'Рамки', values: [true, false], labels: { 'true': 'так', 'false': 'ні' } },
    shelfSize: { name: 'Розмір карток', values: ['s', 'm', 'l'], labels: { s: 'компактні', m: 'звичайні', l: 'великі' } },
    shelfLabels: { name: 'Підписи програм', values: [false, true], labels: { 'false': 'ні', 'true': 'так' } },
    shelfRows: { name: 'Рядів на полиці', values: [1, 2], labels: { 1: 'один', 2: 'два' } },
    sysApps: { name: 'Кнопка «Усі програми»', values: [true, false], labels: { 'true': 'показувати', 'false': 'сховати' } },
    sysWifi: { name: 'Кнопка «Мережа»', values: [true, false], labels: { 'true': 'показувати', 'false': 'сховати' } },
    sysLayout: { name: 'Кнопка «Макет»', values: [true, false], labels: { 'true': 'показувати', 'false': 'сховати' } },
    tz2: { name: 'Місто', values: ['Europe/Warsaw', 'Europe/Berlin', 'Europe/London', 'Europe/Lisbon', 'Asia/Tbilisi', 'Asia/Dubai', 'America/New_York', 'America/Toronto', 'America/Los_Angeles', 'Asia/Tokyo'],
      labels: { 'Europe/Warsaw': 'Варшава', 'Europe/Berlin': 'Берлін', 'Europe/London': 'Лондон', 'Europe/Lisbon': 'Лісабон', 'Asia/Tbilisi': 'Тбілісі', 'Asia/Dubai': 'Дубай', 'America/New_York': 'Нью-Йорк', 'America/Toronto': 'Торонто', 'America/Los_Angeles': 'Лос-Анджелес', 'Asia/Tokyo': 'Токіо' } },
  };

  function defaults() {
    var d = new Date(Date.now() + 30 * 864e5);
    return {
      blocks: BUILTIN.map(function (id) { return { id: id, size: 'm', off: false }; }),
      right: 'map', mapSize: 'm', accent: '', clock: 'thin', font: 'fixel', panels: 'glass', radius: 'round', border: true,
      shelfSize: 'm', shelfLabels: false, shelfRows: 1, sysApps: true, sysWifi: true, sysLayout: true,
      countdown: { label: 'відпустки', date: iso(d) }, note: '', tz2: 'Europe/Warsaw',
    };
  }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var cfg = load();
  function load() {
    var c = defaults();
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v) for (var k in v) c[k] = v[k];
    } catch (e) {}
    // blocks added in later versions show up (hidden) so they can be turned on
    BUILTIN.forEach(function (id) { if (!c.blocks.some(function (b) { return b.id === id; })) c.blocks.push({ id: id, size: 'm', off: false }); });
    return c;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

  // ---------- extra blocks: created on demand inside the left column ----------
  function blockEl(id) {
    var b = BLOCKS[id];
    if (b.sel) return document.querySelector(b.sel);
    var el = $('blk-' + id);
    if (!el) {
      el = document.createElement('div');
      el.id = 'blk-' + id;
      el.className = 'xblk xblk-' + id;
      document.querySelector('.left').appendChild(el);
    }
    return el;
  }
  var DAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
  var MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
  var MONTHS_G = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hol(d) { return H().holiday ? H().holiday(d) : null; }
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; }

  var PAINT = {
    week: function (el) {
      var now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
      var h = '<div class="wk-days">', note = '';
      for (var i = 0; i < 7; i++) {
        var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), hd = hol(d), today = d.toDateString() === now.toDateString();
        h += '<div class="wk-d' + (today ? ' today' : '') + (hd ? ' hol' : '') + (i > 4 ? ' we' : '') + '"><span>' + DAYS[i] + '</span><b>' + d.getDate() + '</b></div>';
        if (hd && d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && !note) note = (today ? 'сьогодні' : DAYS[i] + ', ' + d.getDate() + ' ' + MONTHS_G[d.getMonth()]) + ' · ' + hd;
      }
      el.innerHTML = h + '</div>' + (note ? '<div class="wk-note">' + esc(note) + '</div>' : '');
    },
    ball: function (el) {
      var d = H().ball && H().ball(), name = H().teamName ? H().teamName() : '';
      if (!H().teamId || !H().teamId()) { el.innerHTML = '<div class="xb-h">Футбол</div><div class="xb-dim">оберіть команду: ОК на блоці в конструкторі → Налаштувати</div>'; return; }
      if (!d) { el.innerHTML = '<div class="xb-h">Футбол · ' + esc(name) + '</div><div class="xb-dim">завантажую…</div>'; return; }
      var e = d.live || (d.last && d.last.hs != null && Date.now() - d.last.at < 14 * 3600e3 ? d.last : null) || d.next || d.last;
      if (!e) { el.innerHTML = '<div class="xb-h">Футбол · ' + esc(name) + '</div><div class="xb-dim">матчів не знайдено</div>'; return; }
      var ua = H().teamUA || function (x) { return x; };
      var when;
      if (d.live && e === d.live) when = '<span class="live">наживо</span>';
      else if (e.hs != null) when = 'фінал · ' + new Date(e.at).getDate() + ' ' + MONTHS_G[new Date(e.at).getMonth()];
      else {
        var t = new Date(e.at), dd = Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(new Date().toDateString())) / 864e5);
        when = (dd === 0 ? 'сьогодні' : dd === 1 ? 'завтра' : DAYS[(t.getDay() + 6) % 7] + ', ' + t.getDate() + ' ' + MONTHS_G[t.getMonth()]) + ' о ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
      }
      var score = e.hs != null ? '<b class="sc">' + e.hs + ' : ' + e.as + '</b>' : '<b class="sc vs">—</b>';
      var crest = function (u) { return u ? '<img src="' + esc(u) + '/tiny" onerror="this.onerror=null;this.src=\'' + esc(u) + '\'" alt="">' : '<i></i>'; };
      el.innerHTML = '<div class="xb-h">' + esc((H().leagueUA && H().leagueUA(e.league)) || e.league || 'Футбол') + ' · ' + when + '</div>' +
        '<div class="fb-row"><span class="fb-t">' + crest(e.homeBadge) + esc(ua(e.home)) + '</span>' + score + '<span class="fb-t r">' + esc(ua(e.away)) + crest(e.awayBadge) + '</span></div>';
    },
    front: function (el) {
      var f = H().front && H().front();
      if (!f) { if (H().loadFront) H().loadFront(); el.innerHTML = '<div class="xb-h">Фронт</div><div class="xb-dim">завантажую…</div>'; return; }
      var ch = H().recentChanges ? H().recentChanges() : [];
      var en = ch.filter(function (c) { return c.kind === 'enemy'; }).map(function (c) { return c.name; });
      var ou = ch.filter(function (c) { return c.kind === 'ours'; }).map(function (c) { return c.name; });
      var fresh = ch.length && ch[0].t > Date.now() - 864e5;
      var h = '<div class="xb-h">' + (fresh ? 'Фронт за добу' : ch.length ? 'Фронт · останні зміни ' + (H().ddmm ? H().ddmm(ch[0].t) : '') : 'Фронт') + ' · DeepStateMAP</div>';
      if (!ch.length) h += '<div class="xb-dim">за добу без змін</div>';
      if (en.length) h += '<div class="fr-r en"><i></i>ворог просунувся біля ' + esc(en.join(', ')) + '</div>';
      if (ou.length) h += '<div class="fr-r ou"><i></i>ЗСУ: ' + esc(ou.join(', ')) + '</div>';
      el.innerHTML = h;
    },
    countdown: function (el) {
      var c = cfg.countdown || {}, p = String(c.date || '').split('-');
      var target = new Date(+p[0], +p[1] - 1, +p[2]), today = new Date(new Date().toDateString());
      var n = Math.round((target - today) / 864e5), label = esc(c.label || 'події');
      if (isNaN(n)) { el.innerHTML = '<div class="xb-dim">вкажіть дату в конструкторі</div>'; return; }
      el.innerHTML = n > 0 ? '<b class="cd-n">' + n + '</b><span class="cd-t">' + plural(n, 'день', 'дні', 'днів') + ' до ' + label + '<small>' + target.getDate() + ' ' + MONTHS_G[target.getMonth()] + '</small></span>'
        : n === 0 ? '<b class="cd-n">🎉</b><span class="cd-t">сьогодні — ' + label + '</span>'
        : '<b class="cd-n">' + -n + '</b><span class="cd-t">' + plural(-n, 'день', 'дні', 'днів') + ' після ' + label + '</span>';
    },
    note: function (el) {
      el.innerHTML = cfg.note ? '<div class="nt-t">' + esc(cfg.note) + '</div>' : '<div class="xb-dim">нотатка порожня: ОК на блоці в конструкторі → Налаштувати</div>';
    },
    photo: function (el) { paintPhoto(el, false); },
    tz2: function (el) {
      var tz = cfg.tz2 || 'Europe/Warsaw', name = OPTS.tz2.labels[tz] || tz, t;
      try { t = new Date().toLocaleTimeString('uk-UA', { timeZone: tz, hour: '2-digit', minute: '2-digit' }); } catch (e) { t = '--:--'; }
      var diff = '';
      try {
        var here = new Date(), there = new Date(here.toLocaleString('en-US', { timeZone: tz })), dh = Math.round((there - new Date(here.toLocaleString('en-US'))) / 36e5);
        diff = dh === 0 ? 'як у нас' : (dh > 0 ? '+' : '−') + Math.abs(dh) + ' год';
      } catch (e) {}
      el.innerHTML = '<span class="tz-c">' + esc(name) + '</span><b class="tz-t">' + t + '</b><span class="tz-d">' + diff + '</span>';
    },
  };

  // photo of the day (Wikipedia featured image): small in the column, large on the right side
  var potd = null, potdAt = 0;
  function loadPotd(cb) {
    if (potd && Date.now() - potdAt < 3 * 3600e3) return cb && cb();
    if (!H().getJSON) return;
    H().getJSON('https://tvhome.pichkur.com/api/public/potd', function (err, d) { if (!err && d && d.src) { potd = d; potdAt = Date.now(); } if (cb) cb(); });
  }
  function paintPhoto(el, big) {
    if (!potd) { el.innerHTML = '<div class="xb-dim">фото дня завантажується…</div>'; loadPotd(function () { if (potd) paintPhoto(el, big); }); return; }
    var credit = [potd.artist, potd.license].filter(Boolean).join(' · ');
    var k = potd.src + big;
    if (el.getAttribute('data-k') === k) return;
    el.setAttribute('data-k', k);
    el.innerHTML = '<div class="ph-img" style="background-image:url(\'' + esc(big ? potd.src : potd.small) + '\')"></div>' +
      '<div class="ph-cap"><span>' + esc(potd.caption) + '</span><small>Фото дня Вікіпедії' + (credit ? ' · ' + esc(credit) : '') + '</small></div>';
  }

  // ---------- right side alternatives ----------
  function rightEl() {
    var el = $('sky-alt');
    if (!el) { el = document.createElement('div'); el.id = 'sky-alt'; el.className = 'sky-alt'; document.querySelector('.sky').appendChild(el); }
    return el;
  }
  function paintRight() {
    var r = cfg.right, el = rightEl();
    if (r === 'map' || r === 'none') { if (el.innerHTML) { el.innerHTML = ''; el.removeAttribute('data-k'); } return; }
    var now = new Date();
    if (r === 'photo') { if (!el.querySelector('.ph-img')) el.removeAttribute('data-k'); paintPhoto(el, true); return; }
    el.removeAttribute('data-k');
    if (r === 'clock') {
      var hd = hol(now);
      el.innerHTML = '<div class="bc-t">' + ('0' + now.getHours()).slice(-2) + '<i>:</i>' + ('0' + now.getMinutes()).slice(-2) + '</div>' +
        '<div class="bc-d">' + ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'п’ятниця', 'субота'][now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS_G[now.getMonth()] + '</div>' +
        (hd ? '<div class="bc-h">' + esc(hd) + '</div>' : '');
      return;
    }
    if (r === 'calendar') {
      var y = now.getFullYear(), m = now.getMonth(), first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      var h = '<div class="cal-h">' + MONTHS[m] + ' ' + y + '</div><div class="cal-g">' + DAYS.map(function (d, i) { return '<span class="cal-w' + (i > 4 ? ' we' : '') + '">' + d + '</span>'; }).join('');
      for (var i = 0; i < lead; i++) h += '<span></span>';
      var list = [];
      for (var d = 1; d <= days; d++) {
        var dt = new Date(y, m, d), hd2 = hol(dt), wd = (dt.getDay() + 6) % 7;
        h += '<span class="cal-d' + (d === now.getDate() ? ' today' : '') + (hd2 ? ' hol' : '') + (wd > 4 ? ' we' : '') + '">' + d + '</span>';
        if (hd2 && d >= now.getDate()) list.push(d + ' ' + MONTHS_G[m] + ' · ' + hd2);
      }
      el.innerHTML = h + '</div>' + (list.length ? '<div class="cal-l">' + list.slice(0, 3).map(esc).join('<br>') + '</div>' : '');
    }
  }

  // ---------- clock styles that need their own markup (app.js asks before drawing digits) ----------
  var NOM = ['дванадцята', 'перша', 'друга', 'третя', 'четверта', 'п’ята', 'шоста', 'сьома', 'восьма', 'дев’ята', 'десята', 'одинадцята'];
  var ACC = ['дванадцяту', 'першу', 'другу', 'третю', 'четверту', 'п’яту', 'шосту', 'сьому', 'восьму', 'дев’яту', 'десяту', 'одинадцяту'];
  function words(h, m) {
    var r = Math.round(m / 5) * 5;
    if (r === 60) { r = 0; h++; }
    var cur = h % 12, nxt = (h + 1) % 12;
    var A = { 5: 'п’ять хвилин на ', 10: 'десять хвилин на ', 15: 'чверть на ', 20: 'двадцять хвилин на ', 25: 'двадцять п’ять хвилин на ', 30: 'пів на ' };
    var B = { 35: 'за двадцять п’ять ', 40: 'за двадцять ', 45: 'за чверть ', 50: 'за десять ', 55: 'за п’ять ' };
    return r === 0 ? 'рівно ' + NOM[cur] : A[r] ? A[r] + ACC[nxt] : B[r] + NOM[nxt];
  }
  function clock(text) {
    var box = $('clock'), st = cfg.clock;
    if (st !== 'analog' && st !== 'words') return false;
    var p = text.split(':'), h = +p[0], m = +p[1];
    if (box.getAttribute('data-k') === st + text) return true;
    box.setAttribute('data-k', st + text);
    if (st === 'words') {
      box.innerHTML = '<div class="ck-words">' + words(h, m) + '<small>' + text + '</small></div>';
    } else {
      var ha = (h % 12 + m / 60) * 30, ma = m * 6, ticks = '';
      for (var i = 0; i < 12; i++) ticks += '<line x1="100" y1="' + (i % 3 ? 12 : 8) + '" x2="100" y2="' + (i % 3 ? 20 : 26) + '" transform="rotate(' + i * 30 + ' 100 100)"/>';
      box.innerHTML = '<svg class="ck-analog" viewBox="0 0 200 200"><circle class="face" cx="100" cy="100" r="94"/><g class="ticks">' + ticks + '</g>' +
        '<line class="hh" x1="100" y1="100" x2="100" y2="52" transform="rotate(' + ha + ' 100 100)"/>' +
        '<line class="mh" x1="100" y1="100" x2="100" y2="22" transform="rotate(' + ma + ' 100 100)"/><circle class="pin" cx="100" cy="100" r="5"/></svg>' +
        '<div class="ck-side">' + text + '</div>';
    }
    return true;
  }

  // ---------- apply everything ----------
  function toggleBody(prefix, value, values) {
    values.forEach(function (v) { document.body.classList.remove(prefix + v); });
    if (value != null && value !== '') document.body.classList.add(prefix + value);
  }
  function apply() {
    var left = document.querySelector('.left');
    if (!left) return;
    cfg.blocks.forEach(function (b, i) {
      var meta = BLOCKS[b.id];
      if (!meta) return;
      if (meta.extra && b.off) { var x = $('blk-' + b.id); if (x) x.parentNode.removeChild(x); return; }
      var el = blockEl(b.id);
      if (!el) return;
      el.style.order = String(i + 1);
      el.classList.toggle('blk-off', !!b.off);
      el.classList.toggle('blk-s', b.size === 's');
      el.classList.toggle('blk-l', b.size === 'l');
      if (meta.extra && PAINT[b.id]) PAINT[b.id](el);
    });
    toggleBody('right-', cfg.right, OPTS.right.values);
    toggleBody('mapsz-', cfg.mapSize === 'm' ? '' : cfg.mapSize, ['s', 'l']);
    toggleBody('clock-', cfg.clock === 'thin' ? '' : cfg.clock, ['bold', 'digital', 'analog', 'words']);
    toggleBody('font-', cfg.font === 'fixel' ? '' : cfg.font, ['mono', 'serif', 'round']);
    toggleBody('panels-', cfg.panels === 'glass' ? '' : cfg.panels, ['solid', 'none']);
    toggleBody('rad-', cfg.radius === 'round' ? '' : cfg.radius, ['soft', 'square']);
    toggleBody('shelf-', cfg.shelfSize === 'm' ? '' : cfg.shelfSize, ['s', 'l']);
    document.body.classList.toggle('no-border', !cfg.border);
    document.body.classList.toggle('shelf-labels', !!cfg.shelfLabels);
    document.body.classList.toggle('shelf-rows2', cfg.shelfRows === 2);
    var s = document.body.style;
    if (cfg.accent) { s.setProperty('--amber', cfg.accent); s.setProperty('--clay', cfg.accent); s.setProperty('--amber-soft', cfg.accent); }
    else { s.removeProperty('--amber'); s.removeProperty('--clay'); s.removeProperty('--amber-soft'); }
    paintRight();
    if (H().resetClock) H().resetClock();
    fitSoon();
  }
  // The left column must never run into the shelf: when the chosen blocks don't fit, scale the column.
  var fitT = null;
  function fitSoon() { clearTimeout(fitT); fitT = setTimeout(fit, 120); }
  function fit() {
    var left = document.querySelector('.left');
    if (!left) return;
    left.style.zoom = '';
    var need = left.scrollHeight, have = left.clientHeight;
    if (have > 0 && need > have + 2) left.style.zoom = String(Math.max(0.6, have / need).toFixed(3));
  }
  function tick() {
    cfg.blocks.forEach(function (b) { if (BLOCKS[b.id] && BLOCKS[b.id].extra && !b.off && PAINT[b.id]) { var el = $('blk-' + b.id); if (el) PAINT[b.id](el); } });
    paintRight();
    fit();
  }
  setInterval(tick, 30000);
  // football / front / photo data arrive a few seconds after start: repaint once they are in
  setTimeout(tick, 4000); setTimeout(tick, 9000);

  // ---------- the editor ----------
  var ed = { open: false, i: 0, sub: null, si: 0, moving: null, resetArm: false };
  function listRows() {
    var rows = [{ head: 'Блоки · ОК — дії, ◀ ▶ — розмір' }];
    cfg.blocks.forEach(function (b) { if (BLOCKS[b.id] && !(BLOCKS[b.id].extra && b.off)) rows.push({ block: b.id }); });
    rows.push({ act: 'add', name: '＋ Додати блок' });
    rows.push({ head: 'Екран' });
    ['right', 'mapSize', 'accent', 'clock', 'font', 'panels', 'radius', 'border'].forEach(function (k) { rows.push({ opt: k }); });
    rows.push({ head: 'Полиця' });
    ['shelfSize', 'shelfLabels', 'shelfRows', 'sysApps', 'sysWifi', 'sysLayout'].forEach(function (k) { rows.push({ opt: k }); });
    rows.push({ head: ' ' });
    rows.push({ act: 'reset', name: 'Скинути все як було' });
    rows.push({ act: 'done', name: 'Готово' });
    return rows;
  }
  function blk(id) { for (var i = 0; i < cfg.blocks.length; i++) if (cfg.blocks[i].id === id) return cfg.blocks[i]; return null; }
  function valLabel(k, v) { var o = OPTS[k]; var l = o.labels[String(v)]; return l == null ? String(v) : l; }
  function rowHtml(r, focus) {
    if (r.head) return '<div class="ed-head">' + esc(r.head) + '</div>';
    var cls = 'set-row ed-row' + (focus ? ' focus' : '');
    if (r.block) {
      var b = blk(r.block), mv = ed.moving === r.block;
      return '<div class="' + cls + (b.off ? ' off' : '') + (mv ? ' moving' : '') + '"><span class="nm">' + (mv ? '↕ ' : '') + esc(BLOCKS[r.block].name) + '</span><b>' + (b.off ? 'сховано' : SIZE_NAME[b.size]) + '</b><i>' + (mv ? '▲ ▼' : '◀ ▶') + '</i></div>';
    }
    if (r.opt) {
      var v = cfg[r.opt], sw = r.opt === 'accent' ? '<span class="ed-sw" style="background:' + (v || 'var(--amber)') + '"></span>' : '';
      return '<div class="' + cls + '"><span class="nm">' + esc(OPTS[r.opt].name) + '</span><b>' + sw + esc(valLabel(r.opt, v)) + '</b><i>◀ ▶</i></div>';
    }
    var name = r.act === 'reset' && ed.resetArm ? 'Точно скинути? ОК ще раз' : r.name;
    return '<div class="' + cls + (r.act === 'reset' ? ' danger' : '') + '"><span class="nm">' + esc(name) + '</span></div>';
  }
  function focusables(rows) { var f = []; rows.forEach(function (r, i) { if (!r.head) f.push(i); }); return f; }
  function renderEd() {
    var box = $('ed-list'), rows = listRows(), fs = focusables(rows);
    ed.i = Math.max(0, Math.min(ed.i, fs.length - 1));
    var fi = fs[ed.i];
    box.innerHTML = rows.map(function (r, i) { return rowHtml(r, i === fi); }).join('');
    var f = box.querySelector('.focus');
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
    // outline the block on screen
    var all = document.querySelectorAll('.ed-hl');
    for (var j = 0; j < all.length; j++) all[j].classList.remove('ed-hl');
    var cur = rows[fi];
    if (cur && cur.block) { var el = blockEl(cur.block); if (el && !blk(cur.block).off) el.classList.add('ed-hl'); }
    renderSub();
  }
  function curRow() { var rows = listRows(); return rows[focusables(rows)[ed.i]]; }

  // sub-menus: block actions, «add block», block settings
  function subRows() {
    var s = ed.sub;
    if (!s) return [];
    if (s.kind === 'block') {
      var b = blk(s.id), r = [{ k: 'move', name: 'Перемістити ▲ ▼' }, { k: 'hide', name: b.off ? 'Показати' : (BLOCKS[s.id].extra ? 'Прибрати з екрана' : 'Сховати') }, { k: 'size', name: 'Розмір: ' + SIZE_NAME[b.size] + '  ◀ ▶' }];
      if (BLOCKS[s.id].conf) r.push({ k: 'conf', name: 'Налаштувати' });
      return r;
    }
    if (s.kind === 'add') {
      var av = Object.keys(BLOCKS).filter(function (id) { var b2 = blk(id); return !b2 || b2.off; });
      return av.length ? av.map(function (id) { return { k: 'add:' + id, name: BLOCKS[id].name }; }) : [{ k: 'none', name: 'усі блоки вже на екрані' }];
    }
    if (s.kind === 'conf') {
      if (s.id === 'countdown') return [{ k: 'input:countdown.label', name: 'До чого', value: cfg.countdown.label, ph: 'наприклад: відпустки' }, { k: 'date', name: 'Дата' }];
      if (s.id === 'note') return [{ k: 'input:note', name: 'Текст', value: cfg.note, ph: 'що нагадати' }];
      if (s.id === 'tz2') return [{ k: 'opt:tz2', name: 'Місто' }];
      if (s.id === 'ball') return [{ k: 'team', name: 'Команда' }];
    }
    return [];
  }
  function subValue(r) {
    if (r.k === 'date') { var p = cfg.countdown.date.split('-'); return +p[2] + ' ' + MONTHS_G[+p[1] - 1] + ' ' + p[0] + '  ◀ ▶'; }
    if (r.k === 'opt:tz2') return valLabel('tz2', cfg.tz2) + '  ◀ ▶';
    if (r.k === 'team') return (H().teamName ? H().teamName() : '') + '  ◀ ▶';
    return '';
  }
  function renderSub() {
    var pop = $('ed-pop'), rows = subRows();
    pop.hidden = !ed.sub;
    if (!ed.sub) return;
    ed.si = Math.max(0, Math.min(ed.si, rows.length - 1));
    var title = ed.sub.kind === 'add' ? 'Додати блок' : BLOCKS[ed.sub.id].name;
    pop.innerHTML = '<div class="ed-pt">' + esc(title) + '</div>' + rows.map(function (r, i) {
      var inner = r.k.indexOf('input:') === 0
        ? '<span class="nm">' + esc(r.name) + '</span><input class="ed-in" data-k="' + r.k.slice(6) + '" value="' + esc(r.value || '') + '" placeholder="' + esc(r.ph || '') + '">'
        : '<span class="nm">' + esc(r.name) + '</span><b>' + esc(subValue(r)) + '</b>';
      return '<div class="set-row ed-row' + (i === ed.si ? ' focus' : '') + '">' + inner + '</div>';
    }).join('') + '<div class="am-hint">ОК — вибрати · Назад — закрити</div>';
  }
  function step(list, v, dir) { var i = list.indexOf(v); if (i < 0) i = 0; return list[(i + dir + list.length) % list.length]; }
  function changed() { save(); apply(); renderEd(); }

  function subAct(dir) {
    var rows = subRows(), r = rows[ed.si], s = ed.sub;
    if (!r) return;
    if (s.kind === 'block') {
      var b = blk(s.id);
      if (r.k === 'size') { b.size = step(SIZES, b.size, dir || 1); changed(); return; }
      if (dir) return;
      if (r.k === 'move') { ed.moving = s.id; ed.sub = null; changed(); return; }
      if (r.k === 'hide') { b.off = !b.off; ed.sub = null; changed(); return; }
      if (r.k === 'conf') { ed.sub = { kind: 'conf', id: s.id }; ed.si = 0; renderEd(); return; }
    }
    if (s.kind === 'add' && !dir && r.k.indexOf('add:') === 0) {
      var id = r.k.slice(4), ex = blk(id);
      if (ex) cfg.blocks.splice(cfg.blocks.indexOf(ex), 1);
      cfg.blocks.push({ id: id, size: 'm', off: false });
      ed.sub = BLOCKS[id].conf ? { kind: 'conf', id: id } : null; ed.si = 0;
      changed();
      return;
    }
    if (s.kind === 'conf') {
      if (r.k === 'date') {
        var p = cfg.countdown.date.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2] + (dir || 1));
        cfg.countdown.date = iso(d); changed(); return;
      }
      if (r.k === 'opt:tz2') { cfg.tz2 = step(OPTS.tz2.values, cfg.tz2, dir || 1); changed(); return; }
      if (r.k === 'team') { if (H().stepTeam) H().stepTeam(dir || 1); setTimeout(function () { apply(); renderEd(); }, 50); renderEd(); return; }
      if (r.k.indexOf('input:') === 0 && !dir) {
        var inp = document.querySelector('#ed-pop .focus .ed-in');
        if (inp) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} }
      }
    }
  }
  function saveInput(inp) {
    var k = inp.getAttribute('data-k'), v = inp.value.slice(0, 120);
    if (k === 'note') cfg.note = v;
    else if (k === 'countdown.label') cfg.countdown.label = v;
    inp.blur();
    changed();
  }

  function listAct(dir) {
    var r = curRow();
    if (!r) return;
    if (r.block) {
      var b = blk(r.block);
      if (dir) { b.size = step(SIZES, b.size, dir); changed(); return; }
      ed.sub = { kind: 'block', id: r.block }; ed.si = 0; renderEd(); return;
    }
    if (r.opt) {
      cfg[r.opt] = step(OPTS[r.opt].values, cfg[r.opt], dir || 1);
      if (/^sys|^shelf/.test(r.opt) && H().buildDock) H().buildDock();
      changed(); return;
    }
    if (dir) return;
    if (r.act === 'add') { ed.sub = { kind: 'add' }; ed.si = 0; renderEd(); return; }
    if (r.act === 'done') { close(); return; }
    if (r.act === 'reset') {
      if (!ed.resetArm) { ed.resetArm = true; renderEd(); return; }
      ed.resetArm = false;
      var extras = Object.keys(BLOCKS).filter(function (id) { return BLOCKS[id].extra; });
      extras.forEach(function (id) { var x = $('blk-' + id); if (x) x.parentNode.removeChild(x); });
      BUILTIN.forEach(function (id) { var el = blockEl(id); if (el) { el.style.order = ''; el.classList.remove('blk-off', 'blk-s', 'blk-l'); } });
      cfg = defaults();
      if (H().buildDock) H().buildDock();
      changed();
    }
  }
  function moveBlock(dir) {
    var vis = cfg.blocks.filter(function (b) { return !(BLOCKS[b.id].extra && b.off); });
    var b = blk(ed.moving), at = vis.indexOf(b), to = at + dir;
    if (to < 0 || to >= vis.length) return false;
    var other = vis[to], ia = cfg.blocks.indexOf(b), ib = cfg.blocks.indexOf(other);
    cfg.blocks[ia] = other; cfg.blocks[ib] = b;
    ed.i += dir;
    changed();
    return true;
  }

  function snd(k) { var S = H().SOUND; if (S && S[k]) S[k](); }
  function onKey(e) {
    if (!ed.open) return;
    var k = e.key || '', c = e.keyCode;
    var isUp = k === 'ArrowUp' || c === 19, isDown = k === 'ArrowDown' || c === 20, isL = k === 'ArrowLeft' || c === 21, isR = k === 'ArrowRight' || c === 22;
    var isOk = k === 'Enter' || c === 13 || c === 23, isBack = k === 'Escape' || k === 'Backspace' || k === 'GoBack' || c === 4 || c === 27;
    var act = document.activeElement;
    if (act && act.classList && act.classList.contains('ed-in')) {
      // typing: let the keyboard work; OK or Back finishes
      if (isOk || (isBack && k !== 'Backspace')) { e.preventDefault(); e.stopImmediatePropagation(); saveInput(act); snd('open'); }
      return;
    }
    if (e.type === 'keyup') { if (isOk) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat && isOk) return;
    if (ed.moving) {
      if (isUp || isDown) { snd(moveBlock(isUp ? -1 : 1) ? 'move' : 'edge'); return; }
      if (isOk || isBack || isL || isR) { ed.moving = null; renderEd(); snd('back'); }
      return;
    }
    if (ed.sub) {
      var n = subRows().length;
      if (isUp) { ed.si = Math.max(0, ed.si - 1); renderSub(); snd('move'); }
      else if (isDown) { ed.si = Math.min(n - 1, ed.si + 1); renderSub(); snd('move'); }
      else if (isL || isR) { subAct(isR ? 1 : -1); snd('move'); }
      else if (isOk) { subAct(0); snd('open'); }
      else if (isBack) { ed.sub = null; renderEd(); snd('back'); }
      return;
    }
    var nf = focusables(listRows()).length;
    if (isUp) { ed.i = Math.max(0, ed.i - 1); ed.resetArm = false; renderEd(); snd('move'); }
    else if (isDown) { ed.i = Math.min(nf - 1, ed.i + 1); ed.resetArm = false; renderEd(); snd('move'); }
    else if (isL || isR) { listAct(isR ? 1 : -1); snd('move'); }
    else if (isOk) { listAct(0); snd('open'); }
    else if (isBack) { close(); snd('back'); }
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  document.addEventListener('focusout', function (e) { if (e.target && e.target.classList && e.target.classList.contains('ed-in') && ed.open) saveInput(e.target); });

  function open() {
    var box = $('editor');
    if (!box) {
      box = document.createElement('div');
      box.id = 'editor'; box.className = 'editor';
      box.innerHTML = '<div class="ed-panel"><div class="ed-title">Конструктор екрана<small>▲ ▼ вибір · ◀ ▶ змінити · ОК — дії · Назад — вийти</small></div><div class="ed-list" id="ed-list"></div><div class="ed-pop" id="ed-pop" hidden></div></div>';
      ($('stage') || document.body).appendChild(box); // inside the scaled stage, like the other overlays
    }
    box.hidden = false;
    document.body.classList.add('editing');
    ed.open = true; ed.i = 1; ed.sub = null; ed.moving = null;
    renderEd();
  }
  function close() {
    ed.open = false; ed.sub = null; ed.moving = null;
    if ($('editor')) $('editor').hidden = true;
    document.body.classList.remove('editing');
    var all = document.querySelectorAll('.ed-hl');
    for (var j = 0; j < all.length; j++) all[j].classList.remove('ed-hl');
    fit();
  }
  var prevBack = window.tvBack;
  window.tvBack = function () {
    if (ed.open) {
      var act = document.activeElement;
      if (act && act.classList && act.classList.contains('ed-in')) { saveInput(act); return true; }
      if (ed.moving) ed.moving = null; else if (ed.sub) ed.sub = null; else { close(); snd('back'); return true; }
      renderEd(); snd('back'); return true;
    }
    return prevBack ? prevBack() : false;
  };

  window.TVC = {
    open: open,
    close: close,
    clock: clock,
    cfg: function () { return cfg; },
    sysHidden: function (action) { return (action === 'apps' && !cfg.sysApps) || (action === 'wifi' && !cfg.sysWifi) || (action === 'layout' && !cfg.sysLayout); },
    fit: fitSoon,
  };
  apply();
  // app.js built the shelf before this file loaded: rebuild it once if buttons are hidden or it has two rows
  if ((!cfg.sysApps || !cfg.sysWifi || !cfg.sysLayout || cfg.shelfRows === 2) && H().buildDock) H().buildDock();
  window.addEventListener('resize', fitSoon);
})();
