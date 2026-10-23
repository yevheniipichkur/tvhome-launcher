#!/usr/bin/env python3
"""Download main streets + rivers around each city from OpenStreetMap (Overpass, © OSM contributors, ODbL)
and write web/streets/<state>.svg — thin line art for the «Мапа міста» background.
Polite: one request at a time, pauses between cities, cached raw responses in tools/streets-raw/."""
import json, math, os, sys, time, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
cities = json.load(open(os.path.join(ROOT, '..', 'web', 'cities.json')))
OUT = os.path.join(ROOT, '..', 'web', 'streets'); os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
HALF_W_KM = 7.5                                   # 15 km across the screen

def fetch(c):
    raw = os.path.join(ROOT, 'streets-raw', c['state'] + '.json')
    if os.path.exists(raw):
        return json.load(open(raw))
    lat, lon = c['lat'], c['lon']
    dlat = HALF_W_KM * (H / W) / 111.0 * 1.15
    dlon = HALF_W_KM / (111.0 * math.cos(math.radians(lat))) * 1.15
    bbox = f"{lat-dlat},{lon-dlon},{lat+dlat},{lon+dlon}"
    q = f"""[out:json][timeout:90];
(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"]({bbox});
 way["waterway"~"^(river|canal)$"]({bbox});
 way["railway"="rail"]({bbox}););
out geom;"""
    req = urllib.request.Request(os.environ.get('OVERPASS', 'https://overpass.kumi.systems/api/interpreter'), data=urllib.parse.urlencode({'data': q}).encode(),
                                 headers={'User-Agent': 'TVHome/1.0 (home screen background; one-off per city)'})
    d = json.load(urllib.request.urlopen(req, timeout=180))
    json.dump(d, open(raw, 'w'))
    return d

CLASS = {'motorway': 'a', 'trunk': 'a', 'primary': 'a', 'secondary': 'b', 'tertiary': 'b',
         'residential': 'c', 'unclassified': 'c', 'living_street': 'c'}

def build(c, d):
    lat0, lon0 = c['lat'], c['lon']
    k = (W / 2) / HALF_W_KM                         # px per km
    kx = 111.0 * math.cos(math.radians(lat0)) * k; ky = 111.0 * k
    groups = {'a': [], 'b': [], 'c': [], 'w': [], 'r': []}
    for e in d.get('elements', []):
        t = e.get('tags', {}); g = e.get('geometry')
        if not g: continue
        cls = 'w' if 'waterway' in t else 'r' if 'railway' in t else CLASS.get(t.get('highway'))
        if not cls: continue
        pts, last = [], None
        for p in g:
            x = W / 2 + (p['lon'] - lon0) * kx; y = H / 2 - (p['lat'] - lat0) * ky
            if last and math.hypot(x - last[0], y - last[1]) < (2.2 if cls == 'c' else 1.4): continue
            pts.append((x, y)); last = (x, y)
        if len(pts) < 2: continue
        if all(x < -50 or x > W + 50 for x, _ in pts) or all(y < -50 or y > H + 50 for _, y in pts): continue
        groups[cls].append('M' + 'L'.join(f'{x:.0f},{y:.0f}' for x, y in pts))
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">',
             '<g fill="none" stroke-linecap="round" stroke-linejoin="round">']
    style = {'c': 'stroke="#ffffff" stroke-opacity=".10" stroke-width="1"', 'b': 'stroke="#ffffff" stroke-opacity=".22" stroke-width="1.6"',
             'a': 'stroke="#ffd08c" stroke-opacity=".45" stroke-width="2.4"', 'r': 'stroke="#ffffff" stroke-opacity=".18" stroke-width="1.2" stroke-dasharray="6 5"',
             'w': 'stroke="#5ac8fa" stroke-opacity=".55" stroke-width="3.2"'}
    for cls in ('c', 'r', 'b', 'w', 'a'):
        if groups[cls]: parts.append(f'<path {style[cls]} d="{"".join(groups[cls])}"/>')
    parts.append('</g></svg>')
    svg = ''.join(parts)
    open(os.path.join(OUT, c['state'] + '.svg'), 'w').write(svg)
    return len(svg), {k: len(v) for k, v in groups.items()}

only = sys.argv[1:]
for i, c in enumerate(cities):
    if only and c['name'] not in only: continue
    try:
        d = fetch(c)
        print(c['name'], *build(c, d), flush=True)
    except Exception as e:
        print(c['name'], 'ERROR', e, flush=True)
    if not only and i < len(cities) - 1 and not os.path.exists(os.path.join(ROOT, 'streets-raw', cities[i + 1]['state'] + '.json')):
        time.sleep(20)
