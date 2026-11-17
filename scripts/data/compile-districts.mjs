import { readFileSync, writeFileSync } from 'node:fs';

const directory = new URL('./', import.meta.url);
const catalog = 'https://data.gov.cz/zdroj/datové-sady/00845451/6333fdcab1c60bb548e62809d84bef5f';
const source = 'https://mapy.ostrava.cz/opendata/data/opendata/obvody_WGS84_gjson.zip';
const attribution = 'Statutární město Ostrava';
const license = 'CC BY 4.0';
const licenseUrl = 'https://creativecommons.org/licenses/by/4.0/';
const raw = readFileSync(new URL('official/Obvody_WGS84.geojson', directory), 'utf8').replace(/^\uFEFF/, '');
const official = JSON.parse(raw);
if (official.features.length !== 23) throw new Error('Expected exactly 23 Ostrava municipal districts');
const lonRatio = Math.cos(49.82 * Math.PI / 180);

function clearance(x, y, rings) {
  let distance2 = Infinity;
  let interior = false;
  for (const polygon of rings) for (let i = 1; i < polygon.length; i++) {
    const [x0, y0] = polygon[i - 1];
    const [x1, y1] = polygon[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const den = dx * dx + dy * dy;
    if ((y0 > y) !== (y1 > y) && x < x0 + (y - y0) / dy * dx) interior = !interior;
    const t = den ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / den)) : 0;
    const rx = x - (x0 + dx * t);
    const ry = y - (y0 + dy * t);
    distance2 = Math.min(distance2, rx * rx + ry * ry);
  }
  return interior ? distance2 : -distance2;
}

function labelAnchor(polygon) {
  const rings = polygon.map((ring) => ring.map(([x, y]) => [x * lonRatio, y]));
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const [x, y] of rings[0]) {
    left = Math.min(left, x); right = Math.max(right, x);
    bottom = Math.min(bottom, y); top = Math.max(top, y);
  }
  let best = { x: (left + right) / 2, y: (bottom + top) / 2, score: -Infinity };
  let stepX = (right - left) / 17;
  let stepY = (top - bottom) / 17;
  for (let pass = 0; pass < 4; pass += 1) {
    for (let yi = 0; yi <= 17; yi += 1) for (let xi = 0; xi <= 17; xi += 1) {
      const x = left + xi * stepX;
      const y = bottom + yi * stepY;
      const score = clearance(x, y, rings);
      if (score > best.score) best = { x, y, score };
    }
    left = best.x - stepX;
    bottom = best.y - stepY;
    stepX /= 8.5;
    stepY /= 8.5;
  }
  return { center: [+(best.x / lonRatio).toFixed(7), +best.y.toFixed(7)], distance: Math.sqrt(best.score) };
}

const metadata = { attribution, license, licenseUrl, source, catalog };
const features = official.features.map(({ properties, geometry }) => {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const best = polygons.map(labelAnchor).sort((a, b) => b.distance - a.distance)[0];
  if (!Number.isFinite(best.distance)) throw new Error('No interior label point for ' + properties.NAZEV);
  return {
    type: 'Feature',
    id: String(properties.OBKOD),
    properties: { name: properties.NAZEV, center: best.center },
    geometry,
  };
}).sort((a, b) => Number(a.id) - Number(b.id));

const collection = { type: 'FeatureCollection', ...metadata, features };
const compact = { ...metadata, districts: features.map(({ id, properties }) => ({ id, ...properties })) };
writeFileSync(new URL('districts.geojson', directory), JSON.stringify(collection));
writeFileSync(new URL('districts.json', directory), JSON.stringify(compact));
console.log(compact.districts.map(({ name, center }) => name + ' ' + center.join(', ')).join('\n'));
