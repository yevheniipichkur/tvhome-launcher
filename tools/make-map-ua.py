#!/usr/bin/env python3
"""Builds the TV map from map.ukrainealarm.com's own region geometry, so alerts line up with the
official map down to communities (громади).

  make-map-ua.py regions-standard-v1.geojson web/ukraine.json data/communities.json

- web/ukraine.json: oblasts (rank 1, outline + label) and districts (rank 2, filled), keyed by the
  ukrainealarm regionId, with each district's oblast.
- data/communities.json (server side only): projected paths of the 1 451 communities with their
  district/oblast ids; the server sends just the ones under alert, the page draws them on top.

Projection matches web/app.js: x = (lon - 22) * 60 * cos(48.5°), y = (52.45 - lat) * 60.

Afterwards Crimea's outline is replaced with the OSM one (ua-radar oblasts.geojson, same projection),
because ukrainealarm draws Crimea as a rough blob; see the "note" field in web/ukraine.json.
Each oblast also gets a 'base' path (outer rings only) for the fill underneath, since their oblast
polygons have holes where city communities sit.
"""
import json, math, sys

LON0, LAT1, LAT0, K = 22.0, 52.45, 48.5, 60.0
COS = math.cos(math.radians(LAT0))
proj = lambda lon, lat: ((lon - LON0) * K * COS, (LAT1 - lat) * K)


def polys(geom):
    return geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]


def path(geom, step):
    d = []
    for poly in polys(geom):
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


def inside(pt, ring):
    x, y = pt; c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def contains(geom, pt):
    return any(inside(pt, p[0]) and not any(inside(pt, h) for h in p[1:]) for p in polys(geom))


def samples(geom, n=12):
    ring = max((p[0] for p in polys(geom)), key=len)
    cx = sum(p[0] for p in ring) / len(ring); cy = sum(p[1] for p in ring) / len(ring)
    pts = [(cx, cy)]
    for i in range(n):  # points pulled from the outline towards the middle
        px, py = ring[i * len(ring) // n]
        pts.append((px + (cx - px) * 0.15, py + (cy - py) * 0.15))
    return pts


def parent(geom, candidates):
    best, score = None, -1
    for cid, cg in candidates:
        s = sum(contains(cg, p) for p in samples(geom))
        if s > score:
            best, score = cid, s
    return best


def label_point(geom):
    # area centroid of the largest ring, in map units
    ring = max((p[0] for p in polys(geom)), key=lambda r: abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(r, r[1:]))))
    pts = [proj(*p) for p in ring]
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        cr = x1 * y2 - x2 * y1
        a += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr
    if abs(a) < 1e-9:
        return pts[0]
    return (cx / (3 * a), cy / (3 * a))


SHORT = {'Автономна Республіка Крим': 'Крим', 'м. Київ': 'м. Київ'}

src = json.load(open(sys.argv[1]))['features']
ob = [f for f in src if f['properties']['rank'] == 1]
ds = [f for f in src if f['properties']['rank'] == 2]
cs = [f for f in src if f['properties']['rank'] == 3]
ob_c = [(f['properties']['regionId'], f['geometry']) for f in ob]
ob_name = {f['properties']['regionId']: f['properties']['name'] for f in ob}
ds_c = [(f['properties']['regionId'], f['geometry']) for f in ds]

oblasts = []
for f in ob:
    p = f['properties']
    lx, ly = label_point(f['geometry'])
    oblasts.append({'id': p['regionId'], 'name': p['name'], 'short': SHORT.get(p['name'], p['name'].replace(' область', '')),
                    'd': path(f['geometry'], 1.1), 'label': [round(lx, 1), round(ly, 1)]})

districts = []
d_parent = {}
for f in ds:
    p = f['properties']
    o = parent(f['geometry'], ob_c)
    d_parent[p['regionId']] = o
    districts.append({'id': p['regionId'], 'name': p['name'], 'oblast': o, 'oblastName': ob_name.get(o), 'd': path(f['geometry'], 1.1)})

communities = {}
for f in cs:
    p = f['properties']
    dist = parent(f['geometry'], ds_c)
    communities[p['regionId']] = {'name': p['name'], 'district': dist, 'oblast': d_parent.get(dist), 'd': path(f['geometry'], 0.8)}

W, H = round((40.3 - LON0) * K * COS), round((LAT1 - 44.3) * K)
json.dump({'width': W, 'height': H, 'source': 'map.ukrainealarm.com', 'oblasts': oblasts, 'districts': districts},
          open(sys.argv[2], 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(communities, open(sys.argv[3], 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(oblasts), 'oblasts', len(districts), 'districts', len(communities), 'communities',
      sum(1 for d in districts if d['oblast'] is None), 'districts without oblast')
