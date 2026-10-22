#!/usr/bin/env python3
"""Builds web/ukraine.json (raion + oblast SVG paths) for the TV alert map.
Input: raions.geojson and oblasts.geojson from github.com/funnyazsupport-ship-it/ua-radar/data
(boundaries derived from OpenStreetMap, © OpenStreetMap contributors, ODbL).
Usage: make-map.py raions.geojson oblasts.geojson > web/ukraine.json"""
import json, math, sys

# Same projection as web/app.js
LON0, LAT1, LAT0, K = 22.0, 52.45, 48.5, 60.0
COS = math.cos(math.radians(LAT0))
proj = lambda lon, lat: ((lon - LON0) * K * COS, (LAT1 - lat) * K)

def norm_oblast(n):
    return 'Автономна Республіка Крим' if n == 'АР Крим' else n

def key(oblast, name):
    return norm_oblast(oblast) + '|' + name.replace('’', "'").replace('ʼ', "'")

def path(geom, step):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    d = []
    for poly in polys:
        for ring in poly:
            pts, last = [], None
            for lon, lat in ring:
                x, y = proj(lon, lat)
                if last and math.hypot(x - last[0], y - last[1]) < step:
                    continue
                pts.append((x, y)); last = (x, y)
            if len(pts) >= 4:
                d.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + 'Z')
    return ''.join(d)

raions = [{'key': key(f['properties']['oblast'], f['properties']['name']), 'd': path(f['geometry'], 1.1)}
          for f in json.load(open(sys.argv[1]))['features']]
oblasts = []
for f in json.load(open(sys.argv[2]))['features']:
    p = f['properties']
    cx, cy = proj(*p['centroid'])
    oblasts.append({'name': norm_oblast(p['name']), 'short': p['short'], 'd': path(f['geometry'], 1.1),
                    'label': [round(cx, 1), round(cy, 1)]})
print(json.dumps({'width': round((40.3 - LON0) * K * COS), 'height': round((LAT1 - 44.3) * K),
                  'attribution': '© OpenStreetMap', 'raions': raions, 'oblasts': oblasts}, ensure_ascii=False))
