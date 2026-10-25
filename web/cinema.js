/* Shared TV/phone movie night UI. The room and ballots live only on the Android box. */
(function () {
  'use strict';
  var TV = window.TV, phone = !!window.cinemaApi, panel, state, busy = false, timer, previousFocus;
  var renderKey = '', previous = [], revisit = '', resetAsked = false, reopenAfterPin = false, revision = 0;
  var celebration = null, celebrationId = '', celebrationClosing = false, celebrationTimer, celebrationReturn, celebrationScroll = 0;
  var watchingMatches = false, watchedRound = null, seenMatches = Object.create(null);
  var filterDraft = null, filterMenu = '', controlsKey = '', savedFilterKey = '';
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ICON = {
    film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    back: '<path d="M4 10h11a5 5 0 0 1 0 10M4 10l6-6M4 10l6 6"/>',
    play: '<path d="m9 5 11 7-11 7z"/>',
    check: '<path d="m5 12 4 4L19 6"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>'; }
  function identity() {
    var id;
    try { id = localStorage.getItem('vit-cinema-client'); } catch (e) {}
    if (!id || !/^[a-zA-Z0-9-]{20,64}$/.test(id)) {
      var bytes = new Uint8Array(20);
      try { crypto.getRandomValues(bytes); id = Array.prototype.map.call(bytes, function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); }
      catch (e) { id = Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
      try { localStorage.setItem('vit-cinema-client', id); } catch (e) {}
    }
    return id;
  }
  var client = phone ? identity() : '';
  function request(action, body) {
    body = body || {}; if (phone) body.client = client;
    var promise, controller = phone && window.AbortController ? new AbortController() : null;
    if (phone) promise = window.cinemaApi('cinema/' + action + (action === 'state' ? '?client=' + encodeURIComponent(client) : ''), action === 'state' ? { signal: controller && controller.signal } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller && controller.signal
    });
    else if (TV && TV.cinema) {
      try { promise = Promise.resolve(JSON.parse(TV.cinema(action, JSON.stringify(body)))); }
      catch (e) { promise = Promise.reject(new Error('Не вдалося прочитати кімнату. Спробуйте ще раз.')); }
    } else promise = Promise.reject(new Error('Кіновечір працює у застосунку «Вітальня» на приставці.'));
    var deadline;
    var timeout = new Promise(function (resolve, reject) { deadline = setTimeout(function () {
      reject(new Error('Приставка не відповідає. Перевірте Wi-Fi та спробуйте ще раз.'));
      if (controller) controller.abort();
    }, 8000); });
    return Promise.race([promise, timeout]).then(function (s) {
      clearTimeout(deadline);
      if (!s || !s.ok) throw new Error(s && s.error || 'Не вдалося з’єднатися. Спробуйте ще раз.'); return s;
    }, function (error) { clearTimeout(deadline); throw error; });
  }
  function notice(text) {
    if (!panel) return;
    (celebration ? celebration.querySelector('.cn-celebration-notice') : panel.querySelector('.cn-notice')).textContent = text;
  }
  function catalogMeta() { return state.catalogMeta || { loading: false, hasMore: false }; }
  function joinDisabled() { return state.names.length >= 2 || !state.catalog.length || (!state.round && catalogMeta().loading); }
  function filterOptions(field) {
    var year = new Date().getFullYear();
    if (field === 'genre') return (state.genres || []).map(function (g) { return { value: g.id, label: g.name }; });
    if (field === 'rating') return [0,5,6,7,8,9].map(function (v) { return { value: v, label: v ? 'Від ' + v + ' / 10' : 'Будь-який' }; });
    if (field === 'sort') return [{ value: 'popularity.desc', label: 'Популярні' }, { value: 'vote_average.desc', label: 'Найкращі оцінки' }, { value: 'primary_release_date.desc', label: 'Найновіші' }];
    var periods = [{ value: '1900-' + year, label: 'Усі роки' }];
    for (var y = year; y > year - 5; y--) periods.push({ value: y + '-' + y, label: String(y) });
    periods.push({ value: '2020-' + year, label: '2020 — ' + year });
    [2010,2000,1990,1980].forEach(function (d) { periods.push({ value: d + '-' + (d + 9), label: d + ' — ' + (d + 9) }); });
    periods.push({ value: '1900-1979', label: 'До 1980 року' }); return periods;
  }
  function filterValue(field) { return field === 'period' ? filterDraft.fromYear + '-' + filterDraft.toYear : filterDraft[field]; }
  function filterLabel(field) { var value = String(filterValue(field)), option = filterOptions(field).filter(function (v) { return String(v.value) === value; })[0]; return option ? option.label : value; }
  function renderCatalogControls(force) {
    var box = panel.querySelector('.cn-catalog');
    if (!state.filters || !state.catalogMeta) { box.hidden = true; return; }
    box.hidden = false;
    var meta = catalogMeta(), filterKey = JSON.stringify(state.filters);
    if (filterKey !== savedFilterKey) { filterDraft = Object.assign({}, state.filters); savedFilterKey = filterKey; filterMenu = ''; }
    var key = JSON.stringify([meta, state.round, filterDraft, filterMenu, state.catalog.length]);
    if (!force && key === controlsKey) return;
    controlsKey = key;
    var status = meta.source === 'tmdb' ? 'Каталог TMDB' : 'Офлайн-добірка';
    if (meta.cached && meta.source === 'tmdb') status += ' · збережена копія';
    if (meta.updatedAt) status += ' · ' + new Date(meta.updatedAt).toLocaleDateString('uk-UA');
    status += ' · ' + state.catalog.length + ' фільмів';
    var html = '<div class="cn-catalog-status" role="status">' + esc(meta.loading ? 'Завантажуємо фільми з TMDB…' : status) + '</div>';
    if (!meta.loading && !state.catalog.length) html += '<p class="cn-filter-summary">За цими фільтрами фільмів немає. Спробуйте інший жанр, роки чи рейтинг.</p>';
    if (meta.error) html += '<p class="cn-catalog-error">' + esc(meta.error) + (state.catalog.length ? ' Збережені фільми доступні.' : '') + '</p>';
    if (!state.round) {
      var names = { genre: 'Жанр', period: 'Роки', rating: 'Рейтинг', sort: 'Порядок' };
      html += '<div class="cn-filters">' + Object.keys(names).map(function (field) {
        return '<button class="cn-filter" data-cn="filter:' + field + '"' + (meta.loading ? ' disabled' : '') + '><small>' + names[field] + '</small><b>' + esc(filterLabel(field)) + '</b></button>';
      }).join('') + '<button class="cn-primary" data-cn="apply-filters"' + (meta.loading ? ' disabled' : '') + '>Застосувати</button>' + (meta.error ? '<button class="cn-quiet" data-cn="refresh"' + (meta.loading ? ' disabled' : '') + '>Повторити</button>' : '') + '</div>';
      if (filterMenu) html += '<div class="cn-picker" role="group" aria-label="' + names[filterMenu] + '">' + filterOptions(filterMenu).map(function (option, i) {
        return '<button data-cn="pick-filter:' + i + '" class="' + (String(filterValue(filterMenu)) === String(option.value) ? 'chosen' : '') + '">' + esc(option.label) + '</button>';
      }).join('') + '<button data-cn="close-filter">Готово</button></div>';
    } else html += '<p class="cn-filter-summary">' + esc(filterLabel('genre')) + ' · ' + esc(filterLabel('period')) + (filterDraft.rating ? ' · рейтинг від ' + filterDraft.rating : '') + '. Фільтри спільні для обох глядачів.</p>';
    box.innerHTML = html;
  }
  function moreButton() {
    var m = catalogMeta();
    return m.hasMore ? '<button class="cn-quiet cn-more" data-cn="more"' + (m.loading ? ' disabled' : '') + '>' + (m.loading ? 'Завантажуємо…' : 'Ще фільми') + '</button>' : '';
  }
  function movieMeta(f) {
    var parts = []; if (f.year) parts.push(f.year); if (f.minutes) parts.push(f.minutes + ' хв');
    if (typeof f.rating === 'number' && f.votes) parts.push('TMDB ' + f.rating.toFixed(1) + ' / 10');
    if (f.genre) parts.push(f.genre); return esc(parts.join(' · '));
  }

  function celebrationScope() { return celebration || panel; }
  function dismissCelebration(immediate, restoreFocus) {
    if (!celebration) return;
    if (!immediate && celebrationClosing) return;
    var node = celebration;
    clearTimeout(celebrationTimer);
    function finish() {
      if (celebration !== node) return;
      node.remove(); celebration = null; celebrationId = ''; celebrationClosing = false;
      if (!panel) return;
      var shell = panel.querySelector('.cn-shell'); shell.inert = false; shell.removeAttribute('aria-hidden');
      panel.classList.remove('cn-has-celebration'); panel.setAttribute('aria-labelledby', 'cn-title');
      panel.scrollTop = celebrationScroll;
      if (restoreFocus !== false) {
        var target = Array.prototype.find.call(shell.querySelectorAll('[data-cn]'), function (b) { return b.getAttribute('data-cn') === celebrationReturn; });
        (target || shell.querySelector('.cn-close')).focus();
      }
    }
    if (immediate) { finish(); return; }
    if (celebrationClosing) return;
    celebrationClosing = true; node.classList.remove('is-visible');
    Array.prototype.forEach.call(node.querySelectorAll('button'), function (b) { b.disabled = true; });
    celebrationTimer = setTimeout(finish, 220);
  }
  function showCelebration(id) {
    var f = film(id); if (!f || !panel || phone) return;
    celebrationId = id; celebrationClosing = false;
    celebrationReturn = document.activeElement && document.activeElement.getAttribute('data-cn');
    celebrationScroll = panel.scrollTop;
    var shell = panel.querySelector('.cn-shell'); shell.inert = true; shell.setAttribute('aria-hidden', 'true');
    panel.scrollTop = 0; panel.classList.add('cn-has-celebration'); panel.setAttribute('aria-labelledby', 'cn-celebration-title');
    var node = document.createElement('section'); node.className = 'cn-celebration';
    node.setAttribute('role', 'region'); node.setAttribute('aria-labelledby', 'cn-celebration-title');
    node.innerHTML = '<div class="cn-celebration-inner"><div class="cn-celebration-poster"><span class="cn-celebration-placeholder">' + icon('film') + '</span>' +
      (f.poster ? '<img src="https://image.tmdb.org/t/p/w500' + esc(f.poster) + '" alt="" referrerpolicy="no-referrer">' : '') +
      '</div><div class="cn-celebration-copy"><p class="cn-celebration-confirm">' + icon('heart') + 'Вам обом подобається</p>' +
      '<h2 id="cn-celebration-title"' + (f.title.length > 75 ? ' class="cn-celebration-long"' : '') + '>' + esc(f.title) + '</h2>' +
      '<p class="cn-celebration-people">' + esc(state.names.join(' та ')) + ' обрали цей фільм</p>' +
      '<p class="cn-celebration-meta">' + movieMeta(f) + '</p><p class="cn-celebration-description">' + esc(f.description || 'Опис поки недоступний.') + '</p>' +
      '<div class="cn-celebration-actions"><button class="cn-primary" data-cn="celebrate-play:' + esc(id) + '">' + icon('play') + 'Відкрити в Lampa</button><button class="cn-quiet" data-cn="celebrate-continue">Продовжити вибір</button></div>' +
      '<p class="cn-celebration-extra" aria-live="polite"></p><div class="cn-celebration-notice" role="status" aria-live="polite"></div></div></div>';
    celebration = node; panel.appendChild(node);
    var img = node.querySelector('img'); if (img) img.addEventListener('error', function () { this.hidden = true; });
    // One layout + one frame, never a continuous JS loop on the Mi Box.
    node.getBoundingClientRect();
    requestAnimationFrame(function () { if (celebration === node && !celebrationClosing) node.classList.add('is-visible'); });
    node.querySelector('[data-cn="celebrate-continue"]').focus();
  }
  function syncCelebration() {
    if (phone) return;
    var matches = state.matches || [];
    if (!watchingMatches) {
      watchingMatches = true; watchedRound = state.round; seenMatches = Object.create(null);
      matches.forEach(function (id) { seenMatches[id] = true; });
      return; // Opening an existing room never replays its historical matches.
    }
    if (watchedRound !== state.round) {
      dismissCelebration(true, true); watchedRound = state.round; seenMatches = Object.create(null);
    }
    if (celebration && matches.indexOf(celebrationId) === -1) dismissCelebration(true, true);
    var fresh = matches.filter(function (id) { return !seenMatches[id]; });
    fresh.forEach(function (id) { seenMatches[id] = true; });
    if (!celebration && fresh.length) showCelebration(fresh[0]);
    // Further matches update the list quietly; never replace the film currently being read.
    if (celebration) {
      var other = matches.filter(function (id) { return id !== celebrationId; }).length;
      celebration.querySelector('.cn-celebration-extra').textContent = other ? 'Ще спільних фільмів у списку: ' + other : '';
    }
  }

  function update(s) {
    if (!panel) return;
    if (state && s.round !== state.round) { previous = []; revisit = ''; savedFilterKey = ''; }
    state = s;
    var key = JSON.stringify(s);
    if (key === renderKey) return;
    renderKey = key;
    var focused = document.activeElement && document.activeElement.getAttribute('data-cn');
    var count = state.catalog.length;
    var people = state.names.map(function (name, i) {
      return '<div class="cn-person"><span>' + esc(name) + '</span><b>' + state.progress[i] + ' / ' + count + '</b></div>';
    }).join('');
    if (state.names.length < 2) people += '<div class="cn-person cn-wait"><span>Чекаємо ' + (state.names.length ? 'другий' : 'перший') + ' телефон</span><b>' + (state.names.length + 1) + '</b></div>';
    panel.querySelector('.cn-people').innerHTML = people;
    renderCatalogControls(false);
    if (phone) renderPhone(); else renderTV();
    if (focused) {
      var same = Array.prototype.find.call(panel.querySelectorAll('[data-cn]'), function (b) { return b.getAttribute('data-cn') === focused; });
      if (same) same.focus();
    }
    syncCelebration();
  }
  function failure(e) {
    if (phone && e.message === 'pin') { reopenAfterPin = true; busy = false; close(); return; }
    notice(e.message);
  }
  function poll() {
    if (!panel || busy || document.hidden) return;
    var version = revision;
    request('state').then(function (s) { if (version !== revision || busy) return; notice(''); update(s); }).catch(function (e) { if (version === revision) failure(e); });
  }
  function mutate(action, data, onSuccess) {
    if (busy) return;
    revision++; busy = true; panel.setAttribute('aria-busy', 'true');
    Array.prototype.forEach.call(panel.querySelectorAll('.cn-vote button,.cn-celebration button'), function (b) { b.disabled = true; });
    request(action, data).then(function (s) {
      if (action === 'vote') { previous.push(data.id); revisit = ''; }
      resetAsked = false; renderKey = ''; notice(''); update(s);
      if (onSuccess) onSuccess();
    }).catch(function (e) {
      failure(e);
      if (panel) Array.prototype.forEach.call(panel.querySelectorAll('.cn-vote button,.cn-celebration button'), function (b) { b.disabled = false; });
    }).then(function () { busy = false; if (panel) panel.removeAttribute('aria-busy'); });
  }
  function film(id) { return state.catalog.filter(function (f) { return f.id === id; })[0]; }
  function matches() {
    if (!state.matches.length) return '';
    return '<section class="cn-matches"><h2>' + icon('heart') + 'Вам обом подобається</h2>' + state.matches.map(function (id) {
      var f = film(id);
      return '<button class="cn-match" data-cn="play:' + id + '"><span><b>' + esc(f.title) + '</b><small>' + f.year + ' · ' + esc(f.genre) + '</small></span><span class="cn-open">' + icon('play') + 'Lampa</span></button>';
    }).join('') + '</section>';
  }
  function renderPhone() {
    var area = panel.querySelector('.cn-content');
    if (!state.joined) {
      // Keep the live input node: the other viewer's progress must not erase a draft or hide the keyboard.
      if (area.querySelector('.cn-invite')) {
        var oldMatches = area.querySelector('.cn-matches'); if (oldMatches) oldMatches.remove();
        area.insertAdjacentHTML('afterbegin', matches());
        area.querySelector('[data-cn="join"]').disabled = joinDisabled();
        return;
      }
      area.innerHTML = matches() + '<div class="cn-invite"><div class="cn-orbit">' + icon('film') + '</div><h2>Один вечір.<br>Два «так».</h2><p>Листайте фільми на своїх телефонах. На телевізорі з’являться лише ваші спільні вподобання.</p><label for="cn-name">Ваше ім’я</label><input id="cn-name" autocomplete="given-name" maxlength="32" placeholder="Як вас звати?"><button class="cn-primary" data-cn="join">Приєднатися</button><small>Два телефони · одна мережа Wi-Fi</small></div>';
      panel.querySelector('#cn-name').value = window.cinemaName ? window.cinemaName() : '';
      panel.querySelector('[data-cn="join"]').disabled = joinDisabled();
      return;
    }
    var pending = state.catalog.filter(function (f) { return !Object.prototype.hasOwnProperty.call(state.mine, f.id); });
    var f = revisit ? film(revisit) : pending[0];
    var n = Object.keys(state.mine).length;
    if (!f) {
      var allDone = state.progress.length === 2 && state.progress.every(function (p) { return p >= state.catalog.length; });
      area.innerHTML = moreButton() + '<div class="cn-finished">' + icon('check') + '<h2>Ваш вибір готовий</h2><p>' + (allDone ? state.matches.length ? 'Залишилося обрати один зі спільних фільмів.' : 'Сьогодні смаки розійшлися. Можна змінити останній голос або почати новий вечір на телевізорі.' : 'Поки інший глядач обирає, ваші вподобання вже збережені на приставці.') + '</p><button class="cn-quiet" data-cn="undo">Змінити останній голос</button></div>' + matches();
      return;
    }
    area.innerHTML = '<div class="cn-progress"><span>' + (revisit ? 'Змінити голос' : 'Ваш вибір') + '</span><b>' + n + ' / ' + state.catalog.length + '</b></div><progress class="cn-track" max="' + state.catalog.length + '" value="' + n + '" aria-label="Переглянуто фільмів"></progress>' +
      '<article class="cn-film" data-film="' + f.id + '"><div class="cn-film-art" data-genre="' + esc(f.genre) + '">' + (f.poster ? '<img src="https://image.tmdb.org/t/p/w500' + esc(f.poster) + '" alt="" referrerpolicy="no-referrer">' : '') + '<span class="cn-film-word">' + esc(f.genre) + '</span><span class="cn-film-no">' + ('0' + (state.catalog.indexOf(f) + 1)).slice(-2) + '</span></div><div class="cn-film-info"><div class="cn-meta">' + movieMeta(f) + '</div><h2>' + esc(f.title) + '</h2><p>' + esc(f.description || 'Опис поки недоступний.') + '</p></div></article>' +
      '<div class="cn-vote"><button class="cn-no" data-cn="no:' + f.id + '">' + icon('close') + 'Іншим разом</button><button class="cn-yes" data-cn="yes:' + f.id + '">' + icon('heart') + 'Хочу дивитися</button></div><button class="cn-undo" data-cn="undo"' + (n ? '' : ' disabled') + '>' + icon('back') + 'Повернути попередній</button>' + matches();
    var img = area.querySelector('.cn-film-art img');
    if (img) img.onerror = function () { this.remove(); };
    var card = area.querySelector('.cn-film'), start;
    card.addEventListener('touchstart', function (e) { start = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
    card.addEventListener('touchend', function (e) {
      if (!start || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y;
      start = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) mutate('vote', { round: state.round, id: f.id, yes: dx > 0 });
    }, { passive: true });
  }
  function qr(text) {
    if (!window.qrcode) return '';
    var q = qrcode(0, 'M'); q.addData(text); q.make();
    var n = q.getModuleCount(), path = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.isDark(y, x)) path += 'M' + x + ' ' + y + 'h1v1h-1z';
    return '<svg class="cn-qr" role="img" aria-label="Відкрийте кіновечір на телефоні" viewBox="-4 -4 ' + (n + 8) + ' ' + (n + 8) + '" shape-rendering="crispEdges"><rect x="-4" y="-4" width="' + (n + 8) + '" height="' + (n + 8) + '" fill="white"/><path d="' + path + '" fill="#070b11"/></svg>';
  }
  function renderTV() {
    var r = {};
    try { r = JSON.parse(TV.remoteInfo()); } catch (e) {}
    var url = r.url ? r.url + '&cinema=1' : '';
    var allDone = state.progress.length === 2 && state.progress.every(function (p) { return p >= state.catalog.length; });
    panel.querySelector('.cn-content').innerHTML = '<div class="cn-tv-grid"><section class="cn-connect"><h2>Наведіть камери<br>обох телефонів</h2>' + (url ? qr(url) + '<p>Одна мережа Wi-Fi з приставкою</p><div class="cn-address">' + esc(r.ip) + ':' + esc(r.port) + '</div>' : '<p>Підключіть приставку до Wi-Fi, потім відкрийте кіновечір знову.</p>') + '<p>Оберіть «Кіновечір» у пульті.<br>Після двох «так» фільм з’явиться тут.</p></section><section class="cn-results">' + (state.matches.length ? matches() : '<div class="cn-empty">' + icon('heart') + '<h2>' + (allDone ? 'Цього разу без збігів' : 'Ваш спільний вибір — тут') + '</h2><p>' + (allDone ? 'Можна змінити голоси на телефонах або почати новий вечір.' : 'Кожен обирає сам. Тут з’являться лише фільми, які сподобалися вам обом.') + '</p></div>') + '<div class="cn-reset">' + moreButton() + (resetAsked ? '<p>Очистити голоси обох глядачів?</p><button class="cn-primary" data-cn="reset-confirm">Почати новий вечір</button><button class="cn-quiet" data-cn="reset-cancel">Залишити цей</button>' : '<button class="cn-quiet" data-cn="reset">Новий вечір</button>') + '</div></section></div>';
  }
  function open() {
    if (panel) return;
    revision++; previousFocus = document.activeElement;
    panel = document.createElement('section'); panel.className = 'cn-panel ' + (phone ? 'cn-phone' : 'cn-tv');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'cn-title');
    panel.innerHTML = '<div class="cn-shell"><header class="cn-head"><div><h1 id="cn-title">Що дивимось?</h1><p>Кіновечір удвох</p></div><button class="cn-close" data-cn="close" aria-label="Закрити">' + icon('close') + '</button></header><div class="cn-catalog" hidden></div><div class="cn-people"></div><div class="cn-notice" role="status" aria-live="polite"></div><div class="cn-content"><p class="cn-loading">З’єднуємось із приставкою…</p></div><footer class="cn-credit"><img class="cn-tmdb-logo" src="tmdb-logo.svg" alt="TMDB">This product uses the TMDB API but is not endorsed or certified by TMDB.<br>Відкриття фільму залежить від вашої версії Lampa</footer></div>';
    (phone ? document.body : document.getElementById('stage') || document.body).appendChild(panel);
    if (phone) document.body.classList.add('cn-phone-open');
    {
      var stage = phone ? document.body : document.getElementById('stage');
      if (stage) Array.prototype.forEach.call(stage.children, function (child) { if (child !== panel) { child.setAttribute('data-cn-inert', child.inert ? '1' : '0'); child.inert = true; } });
    }
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cn]'); if (!b || busy || b.disabled) return;
      var a = b.getAttribute('data-cn').split(':'), type = a[0], id = a[1];
      if (type === 'celebrate-continue') { dismissCelebration(false, true); return; }
      if (type === 'celebrate-play') { mutate('play', { round: state.round, id: id }, function () { dismissCelebration(true, true); }); return; }
      if (type === 'close') { close(); return; }
      if (!state) { poll(); return; }
      if (type === 'filter') { filterMenu = filterMenu === id ? '' : id; renderCatalogControls(true); var pick = panel.querySelector('.cn-picker button.chosen') || panel.querySelector('.cn-picker button'); if (pick) pick.focus(); return; }
      if (type === 'close-filter') { filterMenu = ''; renderCatalogControls(true); var firstFilter = panel.querySelector('.cn-filter'); if (firstFilter) firstFilter.focus(); return; }
      if (type === 'pick-filter') {
        var option = filterOptions(filterMenu)[+id]; if (!option) return;
        var field = filterMenu;
        if (field === 'period') { var years = String(option.value).split('-'); filterDraft.fromYear = +years[0]; filterDraft.toYear = +years[1]; }
        else filterDraft[field] = option.value;
        filterMenu = ''; renderCatalogControls(true); var chosenField = panel.querySelector('[data-cn="filter:' + field + '"]'); if (chosenField) chosenField.focus(); return;
      }
      if (type === 'apply-filters') { mutate('configure', { filters: filterDraft }); return; }
      if (type === 'refresh') { mutate('refresh'); return; }
      if (type === 'more') { mutate('more', { round: state.round || '' }); return; }
      if (type === 'join') { mutate('join', { name: panel.querySelector('#cn-name').value.trim() }); return; }
      if (type === 'yes' || type === 'no') { mutate('vote', { round: state.round, id: id, yes: type === 'yes' }); return; }
      if (type === 'play') { mutate('play', { round: state.round, id: id }); return; }
      if (type === 'undo') {
        revisit = previous.pop() || state.catalog.filter(function (f) { return Object.prototype.hasOwnProperty.call(state.mine, f.id); }).slice(-1).map(function (f) { return f.id; })[0] || '';
        renderPhone(); return;
      }
      if (type === 'reset') { resetAsked = true; renderTV(); }
      if (type === 'reset-cancel') { resetAsked = false; renderTV(); }
      if (type === 'reset-confirm') { mutate('reset'); return; }
      if (!phone) panel.querySelector('.cn-reset button').focus();
    });
    watchingMatches = false; seenMatches = Object.create(null);
    renderKey = ''; controlsKey = ''; savedFilterKey = ''; filterDraft = null; filterMenu = ''; state = null; resetAsked = false; panel.querySelector('.cn-close').focus();
    poll(); timer = setInterval(poll, 1500);
  }
  function close() {
    if (!panel || busy) return;
    dismissCelebration(true, false); watchingMatches = false;
    revision++; clearInterval(timer); panel.remove(); panel = null; state = null; renderKey = '';
    document.body.classList.remove('cn-phone-open');
    Array.prototype.forEach.call(document.querySelectorAll('[data-cn-inert]'), function (child) { child.inert = child.getAttribute('data-cn-inert') === '1'; child.removeAttribute('data-cn-inert'); });
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }
  window.addEventListener('keydown', function (e) {
    if (!panel) return;
    var code = e.keyCode, key = e.key;
    var back = key === 'Escape' || key === 'GoBack' || code === 4;
    var arrow = /^Arrow/.test(key) || [19, 20, 21, 22].indexOf(code) >= 0;
    var enter = key === 'Enter' || code === 23;
    if (back) { e.preventDefault(); if (celebration) { if (!busy) dismissCelebration(false, true); } else close(); }
    else if (!phone && (arrow || key === 'Tab')) {
      e.preventDefault();
      var buttons = Array.prototype.filter.call(celebrationScope().querySelectorAll('button'), function (b) { return !b.disabled; });
      var i = buttons.indexOf(document.activeElement), dir = key === 'ArrowUp' || key === 'ArrowLeft' || code === 19 || code === 21 || e.shiftKey ? -1 : 1;
      if (buttons.length) buttons[(i + dir + buttons.length) % buttons.length].focus();
    } else if (!phone && enter) { e.preventDefault(); if (!e.repeat && document.activeElement) document.activeElement.click(); }
    else if (phone && key === 'Tab') {
      var fields = panel.querySelectorAll('button:not(:disabled),input'), first = fields[0], last = fields[fields.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    e.stopImmediatePropagation();
  }, true);
  window.addEventListener('keyup', function (e) { if (panel) e.stopImmediatePropagation(); }, true);
  var oldBack = window.tvBack;
  if (!phone) window.tvBack = function () { if (celebration) { if (!busy) dismissCelebration(false, true); return true; } if (panel) { close(); return true; } return oldBack ? oldBack() : false; };
  function motion() {
    var off = false; try { off = localStorage.getItem('tv-world-motion') === '0'; } catch (e) {}
    document.body.classList.toggle('world-still', off);
    document.body.classList.toggle('world-paused', document.hidden);
  }
  document.addEventListener('visibilitychange', function () { motion(); if (!document.hidden) poll(); });
  window.Cinema = { openTV: open, motion: motion, pinReady: function () { if (reopenAfterPin) { reopenAfterPin = false; open(); } } };
  motion();
  if (phone) {
    var entry = document.createElement('button'); entry.className = 'cn-entry'; entry.innerHTML = icon('film') + '<span><b>Що дивимось удвох?</b><small>Два телефони. Один спільний фільм.</small></span>';
    entry.onclick = open; var wrap = document.querySelector('.wrap');
    if (wrap) wrap.insertBefore(entry, wrap.querySelector('.who') ? wrap.querySelector('.who').nextSibling : wrap.firstChild);
    if (window.cinemaAutoOpen || new URLSearchParams(location.search).get('cinema') === '1') open();
  }
})();
