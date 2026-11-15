#!/usr/bin/env node
/* COUNTRY BOUNDARIES FOR "USE MY LOCATION" (Nov 15).

   The owner: "make sure AMV can access location". A position becomes a
   country ON THE DEVICE - the coordinates are never sent anywhere, to AMV or
   to anybody else - by testing the point against these outlines.

   Source: Natural Earth 1:50m Admin 0 countries (public domain,
   naturalearthdata.com), as published in nvkelso/natural-earth-vector.
   Each country's outer rings, rounded to 0.05 degrees (about 5 km), stored as
   integer steps with the first point absolute and the rest as differences.
   Holes are not kept: a point inside a country that sits inside another
   (Lesotho in South Africa) matches both, and the page takes the smaller.

     node scripts/geo-countries.mjs path/to/ne_50m_admin_0_countries.geojson */
import { readFileSync, writeFileSync } from 'fs';
const src = process.argv[2];
if (!src) { console.error('usage: node scripts/geo-countries.mjs ne_50m_admin_0_countries.geojson'); process.exit(2); }
const STEP = 0.05;
const d = JSON.parse(readFileSync(src, 'utf8'));
const out = {};
let points = 0;
for (const f of d.features) {
  const p = f.properties || {};
  const iso = String(p.ISO_A2_EH || p.ISO_A2 || '');
  if (!/^[A-Z]{2}$/.test(iso)) continue;
  const g = f.geometry; if (!g) continue;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
  for (const poly of polys) {
    const ring = poly[0]; const pts = [];
    for (const [x, y] of ring) {
      const q = [Math.round(x / STEP), Math.round(y / STEP)];
      const l = pts[pts.length - 1];
      if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q);
    }
    if (pts.length < 4) continue;
    const enc = [pts[0][0], pts[0][1]];
    for (let i = 1; i < pts.length; i++) enc.push(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    (out[iso] = out[iso] || []).push(enc);
    points += pts.length;
  }
}
const doc = { source: 'Natural Earth 1:50m Admin 0 - Countries (public domain), naturalearthdata.com', step: STEP, c: out };
writeFileSync('data/geo/countries.json', JSON.stringify(doc));
console.log(Object.keys(out).length + ' countries, ' + points + ' points');
