/* Background scenes for TVHome (ES5, no build step).
   window.Scene.city(el, city, phase, weather) — a city silhouette under a live sky: clouds, rain,
     snow or fog from the real weather, lit windows after dark. Lviv is drawn by hand (Високий замок
     with the TV tower, Латинський собор, вежа Корнякта, Ратуша, Домініканський собор, Опера,
     собор Святого Юра); other cities get a generated skyline seeded by the city name.
   window.Scene.streets(el, city) — line art of the city's streets and rivers (web/streets/<state>.svg,
     © OpenStreetMap contributors, ODbL).
   Everything is static SVG: drawn once per change, nothing animates (the box GPU is weak). */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1920, SH = 470; // skyline viewBox height, anchored to the bottom of the screen

  function rng(seed) { // tiny deterministic PRNG
    var s = 0;
    for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  var PAL = { // silhouette, far layer, window light
    night:  ['#03060f', '#0a1230', '#ffcf7a'],
    dawn:   ['#120a1d', '#2a1838', '#ffd29a'],
    day:    ['#071528', '#0f2a4a', null],
    golden: ['#150a05', '#33190b', '#ffd08a'],
    dusk:   ['#0b0718', '#211438', '#ffcf7a'],
  };

  // ---------- skyline pieces ----------
  function rect(x, y, w, h) { return 'M' + x + ',' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'Z'; }
  function spire(cx, base, w, tip) { return 'M' + (cx - w / 2) + ',' + base + 'L' + cx + ',' + tip + 'L' + (cx + w / 2) + ',' + base + 'Z'; }
  function dome(cx, y, r) { return 'M' + (cx - r) + ',' + y + 'A' + r + ',' + r + ' 0 0 1 ' + (cx + r) + ',' + y + 'Z'; }
  function onion(cx, y, r) { // baroque cupola
    return 'M' + (cx - r) + ',' + y + 'C' + (cx - r) + ',' + (y - r * 1.1) + ' ' + (cx - r * 0.2) + ',' + (y - r * 1.2) + ' ' + cx + ',' + (y - r * 1.9) +
      'C' + (cx + r * 0.2) + ',' + (y - r * 1.2) + ' ' + (cx + r) + ',' + (y - r * 1.1) + ' ' + (cx + r) + ',' + y + 'Z';
  }
  function cross(cx, top, h) { return rect(cx - 1.5, top, 3, h) + rect(cx - 7, top + h * 0.3, 14, 3); }

  // a row of tenements (kamenytsi) with pitched roofs and windows
  function tenements(x0, x1, base, hMin, hMax, r, wins) {
    var d = '', x = x0;
    while (x < x1) {
      var w = 46 + Math.floor(r() * 50), h = hMin + Math.floor(r() * (hMax - hMin));
      if (x + w > x1) w = x1 - x;
      var top = base - h, roof = 8 + r() * 18;
      d += 'M' + x + ',' + base + 'V' + top + 'L' + (x + w / 2) + ',' + (top - roof) + 'L' + (x + w) + ',' + top + 'V' + base + 'Z';
      for (var fy = top + 14; fy < base - 14; fy += 22)
        for (var fx = x + 8; fx < x + w - 10; fx += 14) wins.push([fx, fy]);
      x += w;
    }
    return d;
  }

  function lviv(r, wins) {
    var b = SH, far = '', near = '';
    // far layer: Високий замок hill with the TV tower, a soft line of roofs
    far += 'M0,' + b + 'V300Q120,214 250,208Q380,204 560,320L560,' + b + 'Z';
    far += rect(248, 40, 5, 170) + rect(238, 120, 25, 10) + rect(243, 70, 15, 6) + spire(250.5, 42, 4, 8);
    far += tenements(540, 1920, b, 150, 205, r, []);
    // near layer: old town tenements
    near += tenements(380, 1920, b, 92, 150, r, wins);
    // Латинський собор: gothic body + tall spire
    near += rect(560, b - 190, 110, 190) + spire(615, b - 190, 110, b - 238) + rect(596, b - 300, 26, 110) + spire(609, b - 300, 30, b - 372);
    // вежа Корнякта: renaissance tower with tiered cap
    near += rect(748, b - 300, 34, 300) + rect(742, b - 312, 46, 12) + dome(765, b - 312, 18) + rect(762, b - 352, 6, 22) + dome(765, b - 352, 8) + spire(765, b - 358, 4, b - 380);
    // Ратуша: square tower, octagonal belfry, cupola and spire — the tallest
    near += rect(880, b - 175, 170, 175);
    near += rect(944, b - 360, 44, 190) + rect(938, b - 368, 56, 10) + rect(948, b - 410, 36, 42) + onion(966, b - 410, 20) + rect(964, b - 452, 4, 20) + spire(966, b - 450, 6, b - 470);
    // Домініканський собор: drum, great dome, lantern, two side towers
    near += rect(1080, b - 165, 170, 165) + rect(1098, b - 215, 134, 50) + dome(1165, b - 215, 66) + rect(1155, b - 300, 20, 24) + dome(1165, b - 300, 12) + cross(1165, b - 336, 26);
    near += rect(1078, b - 230, 26, 65) + onion(1091, b - 230, 13) + rect(1226, b - 230, 26, 65) + onion(1239, b - 230, 13);
    // Оперний театр: wide body, central attic, the winged statue on top
    near += rect(1330, b - 140, 300, 140) + rect(1420, b - 186, 120, 46) + dome(1480, b - 186, 52) + rect(1474, b - 262, 12, 30);
    near += 'M1462,' + (b - 248) + 'L1480,' + (b - 274) + 'L1498,' + (b - 248) + 'L1480,' + (b - 256) + 'Z'; // wings
    near += rect(1336, b - 162, 30, 22) + rect(1594, b - 162, 30, 22);
    // Собор Святого Юра on its hill: baroque dome and two little towers
    near += 'M1660,' + b + 'Q1770,' + (b - 120) + ' 1920,' + (b - 110) + 'V' + b + 'Z';
    near += rect(1730, b - 215, 120, 105) + rect(1762, b - 250, 56, 35) + onion(1790, b - 250, 30) + cross(1790, b - 330, 26);
    near += rect(1726, b - 238, 20, 28) + onion(1736, b - 238, 10) + rect(1834, b - 238, 20, 28) + onion(1844, b - 238, 10);
    return { far: far, near: near };
  }

  function generic(name, r, wins) {
    var b = SH, far = '', near = '';
    far += tenements(0, 1920, b, 170, 260, r, []);
    // a TV tower somewhere on the left third
    var tx = 160 + Math.floor(r() * 400);
    far += rect(tx, b - 400, 6, 400) + rect(tx - 12, b - 300, 30, 12) + spire(tx + 3, b - 400, 6, b - 440);
    near += tenements(0, 1920, b, 90, 170, r, wins);
    // two or three landmarks: domes, spires, a block
    var n = 2 + Math.floor(r() * 2);
    for (var i = 0; i < n; i++) {
      var x = 500 + i * 450 + Math.floor(r() * 200);
      if (r() < 0.5) near += rect(x, b - 190, 120, 190) + dome(x + 60, b - 190, 48) + cross(x + 60, b - 272, 26);
      else near += rect(x, b - 230, 70, 230) + spire(x + 35, b - 230, 70, b - 320);
    }
    return { far: far, near: near };
  }

  // ---------- sky weather ----------
  function cloudsSvg(code, r, colour, opacity) {
    var n = code >= 3 ? 9 : code === 2 ? 5 : code >= 45 ? 4 : 0;
    if (code >= 51) n = 10;
    var s = '';
    for (var i = 0; i < n; i++) {
      var cx = (i / n) * 2000 + r() * 160 - 40, cy = 90 + r() * 360, w = 220 + r() * 260, h = 44 + r() * 30;
      s += '<g opacity="' + (opacity * (0.55 + r() * 0.45)).toFixed(2) + '" fill="' + colour + '">' +
        '<ellipse cx="' + cx.toFixed(0) + '" cy="' + cy.toFixed(0) + '" rx="' + (w / 2).toFixed(0) + '" ry="' + (h / 2).toFixed(0) + '"/>' +
        '<ellipse cx="' + (cx - w * 0.18).toFixed(0) + '" cy="' + (cy - h * 0.35).toFixed(0) + '" rx="' + (w * 0.24).toFixed(0) + '" ry="' + (h * 0.6).toFixed(0) + '"/>' +
        '<ellipse cx="' + (cx + w * 0.12).toFixed(0) + '" cy="' + (cy - h * 0.5).toFixed(0) + '" rx="' + (w * 0.2).toFixed(0) + '" ry="' + (h * 0.7).toFixed(0) + '"/></g>';
    }
    return s;
  }

  function precipSvg(code) {
    var rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    var snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
    var fog = code === 45 || code === 48;
    var s = '<defs>' +
      '<pattern id="sc-rain" width="46" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(14)"><path d="M10 0v22M32 34v22" stroke="#bcd6f5" stroke-width="1.4" stroke-opacity=".35"/></pattern>' +
      '<pattern id="sc-snow" width="60" height="60" patternUnits="userSpaceOnUse"><circle cx="12" cy="14" r="2.2" fill="#fff" fill-opacity=".55"/><circle cx="42" cy="44" r="1.6" fill="#fff" fill-opacity=".4"/><circle cx="48" cy="10" r="1.2" fill="#fff" fill-opacity=".35"/></pattern>' +
      '<linearGradient id="sc-fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d2de" stop-opacity="0"/><stop offset=".7" stop-color="#c9d2de" stop-opacity=".22"/><stop offset="1" stop-color="#c9d2de" stop-opacity=".32"/></linearGradient>' +
      '</defs>';
    if (rain) s += '<rect width="1920" height="1080" fill="url(#sc-rain)"/>';
    if (snow) s += '<rect width="1920" height="1080" fill="url(#sc-snow)"/>';
    if (fog) s += '<rect y="520" width="1920" height="560" fill="url(#sc-fog)"/>';
    return s;
  }

  var lastKey = '';
  function city(el, c, phase, weather) {
    var code = weather ? weather.code : 2;
    var key = [c.name, phase, code].join('|');
    if (key === lastKey && el.firstChild) return;
    lastKey = key;
    var pal = PAL[phase] || PAL.night;
    var r = rng(c.name + 'v1'), wins = [];
    var sky = c.name === 'Львів' ? lviv(r, wins) : generic(c.name, r, wins);
    var dark = phase === 'night' || phase === 'dusk' || phase === 'dawn';
    var cloudColour = phase === 'day' ? '#dbe7f5' : phase === 'golden' ? '#f0b07a' : phase === 'dawn' ? '#e6a3a0' : '#3a4566';
    var cloudOpacity = phase === 'day' ? 0.22 : 0.3;
    var lights = '';
    if (pal[2]) {
      var lr = rng(c.name + phase);
      var share = phase === 'night' ? 0.32 : phase === 'dusk' ? 0.45 : phase === 'golden' ? 0.12 : 0.18;
      for (var i = 0; i < wins.length; i++) if (lr() < share) lights += 'M' + wins[i][0] + ',' + wins[i][1] + 'h5v8h-5Z';
    }
    var html =
      '<svg class="sc-sky" viewBox="0 0 1920 1080" preserveAspectRatio="none">' + cloudsSvg(code, rng(c.name + code), cloudColour, cloudOpacity) + (code === 45 || code === 48 ? precipSvg(code) : '') + '</svg>' +
      '<svg class="sc-line" viewBox="0 0 ' + W + ' ' + SH + '" preserveAspectRatio="xMidYMax slice">' +
      '<path d="' + sky.far + '" fill="' + pal[1] + '" opacity=".9"/>' +
      '<path d="' + sky.near + '" fill="' + pal[0] + '"/>' +
      (lights ? '<path d="' + lights + '" fill="' + pal[2] + '" opacity="' + (dark ? 0.85 : 0.55) + '"/>' : '') +
      '</svg>' +
      '<div class="sc-ground" style="background:' + pal[0] + '"></div>';
    el.innerHTML = html;
    el.setAttribute('data-kind', 'city');
  }

  function streets(el, c) {
    var key = 'streets|' + c.state;
    if (key === lastKey && el.firstChild) return;
    lastKey = key;
    el.innerHTML = '<img class="sc-streets" alt="" src="streets/' + c.state + '.svg" onerror="this.style.display=\'none\'">' +
      '<div class="sc-streets-credit">мапа: © OpenStreetMap</div>';
    el.setAttribute('data-kind', 'streets');
  }

  function clear(el) { lastKey = ''; el.innerHTML = ''; el.removeAttribute('data-kind'); }

  window.Scene = { city: city, streets: streets, clear: clear };
})();
