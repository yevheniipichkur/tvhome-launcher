/* The phone reflects the box's media stream. No independent volume value or HDMI commands. */
(function () {
  'use strict';
  window.VolumeRemote = function (root, api, feedback) {
    var input = root.querySelector('input'), output = root.querySelector('output');
    var status = root.querySelector('.volume-state'), message = root.querySelector('.volume-message');
    var mute = root.querySelector('[data-volume="mute"]'), buttons = root.querySelectorAll('[data-volume]');
    var confirmed = null, pending = false, queue = [], revision = 0, available = false;
    var speaker = '<path d="M3 9h4l5-4v14l-5-4H3z"/>';
    function usable(s) { return s && Number.isFinite(s.vol) && Number.isFinite(s.volMax) && s.volMax > 0; }
    function paint(s, optimistic) {
      if (!usable(s)) return;
      var quiet = !!s.muted || s.vol === 0, percent = quiet ? 0 : Math.round(100 * s.vol / s.volMax);
      var fixed = !!s.volFixed;
      root.classList.toggle('is-muted', quiet); root.classList.toggle('is-fixed', fixed);
      input.max = s.volMax; input.value = quiet ? 0 : s.vol;
      input.style.setProperty('--volume-fill', percent + '%');
      input.setAttribute('aria-valuetext', fixed ? 'Гучність регулює телевізор або ресивер' : quiet ? 'Без звуку' : percent + ' відсотків');
      output.textContent = percent + '%'; status.textContent = fixed ? 'Керує телевізор або ресивер' : quiet ? 'Без звуку' : 'Приставка';
      mute.setAttribute('aria-pressed', String(!!s.muted));
      mute.setAttribute('aria-label', s.muted ? 'Увімкнути звук' : 'Вимкнути звук');
      mute.querySelector('svg').innerHTML = speaker + (quiet ? '<path d="m17 9 5 6m0-6-5 6"/>' : '<path d="M16 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>');
      input.disabled = !available || fixed;
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = !available || fixed; });
      root.setAttribute('aria-busy', String(!!optimistic));
    }
    function fail(error) {
      queue = []; pending = false;
      if (confirmed) paint(confirmed, false);
      message.textContent = error === 'volume-fixed' ? 'Гучність регулює телевізор або ресивер.' : 'Не вдалося змінити гучність. Перевірте з’єднання й повторіть.';
    }
    function drain() {
      if (pending || !queue.length) return;
      var command = queue.shift(); pending = true;
      var path = command.type === 'set' ? 'vol?v=' + command.value : 'key?k=' + command.value;
      api(path, { method: 'POST' }).then(function (s) {
        if (!s.ok || !usable(s)) { fail(s.error); return; }
        confirmed = s; pending = false;
        if (!queue.length) paint(s, false);
        drain();
      }).catch(function () { fail(); });
    }
    function send(type, value) {
      if (!available || !confirmed || confirmed.volFixed) return;
      revision++; message.textContent = '';
      if (type === 'set' && queue.length && queue[queue.length - 1].type === 'set') queue[queue.length - 1].value = value;
      else queue.push({ type: type, value: value });
      drain();
    }
    input.addEventListener('input', function () {
      var v = Number(input.value); if (!confirmed) return;
      paint({ vol: v, volMax: confirmed.volMax, muted: v === 0, volFixed: false }, true);
      send('set', v);
    });
    Array.prototype.forEach.call(buttons, function (b) { b.addEventListener('click', function () { feedback(); send('key', b.getAttribute('data-volume')); }); });
    return {
      revision: function () { return pending || queue.length ? -1 : revision; },
      sync: function (s, started) {
        if (started !== revision || pending || queue.length || !usable(s)) return;
        available = true; confirmed = s; paint(s, false); message.textContent = '';
      },
      offline: function () {
        available = false; input.disabled = true;
        Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
        status.textContent = 'Немає з’єднання';
      },
      key: function (key) { feedback(); send('key', key); }
    };
  };
})();
