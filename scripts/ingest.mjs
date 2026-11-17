import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { region, withinCoverage } from '../public/js/geo.js';

const args = process.argv.slice(2);
if (!args.length) throw new Error('Pass one Overpass JSON export or OpenStreetMap .osm extracts.');
const elements = new Map();
let sourceTime = '';
const decode = (value) => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity) => {
  const names = { '&amp;':'&', '&quot;':'"', '&apos;':"'", '&lt;':'<', '&gt;':'>' };
  return names[entity] ?? String.fromCodePoint(entity.startsWith('&#x') ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10));
});
const attributes = (line) => Object.fromEntries(Array.from(line.matchAll(/([\w:]+)="([^"]*)"/g), ([, key, value]) => [key, decode(value)]));

for (const path of args) {
  const input = await readFile(path, 'utf8');
  if (input.trimStart().startsWith('{')) {
    const document = JSON.parse(input);
    if (document.remark || !document.elements?.length) throw new Error('Incomplete Overpass response: ' + path);
    sourceTime = document.osm3s?.timestamp_osm_base || sourceTime;
    for (const element of document.elements) elements.set(element.type + element.id, element);
    continue;
  }
  if (!input.includes('</osm>')) throw new Error('Incomplete OSM XML: ' + path);
  for (const [, type, header, body = ''] of input.matchAll(/<(node|way|relation)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
    const attrs = attributes(header);
    const element = { type, id: Number(attrs.id), tags: {} };
    if (type === 'node') Object.assign(element, { lat: Number(attrs.lat), lon: Number(attrs.lon) });
    if (type === 'way') element.nodes = [];
    if (type === 'relation') element.members = [];
    for (const [, kind, item] of body.matchAll(/<(tag|nd|member)\s+([^>]+)\/>/g)) {
      const value = attributes(item);
      if (kind === 'tag') element.tags[value.k] = value.v;
      if (kind === 'nd') element.nodes.push(Number(value.ref));
      if (kind === 'member') element.members.push({ ...value, ref: Number(value.ref) });
    }
    elements.set(type + element.id, element);
  }
}

const point = ({lon, lat}) => [lon, lat];
const wayPoints = (e) => {
  if (e.geometry) return e.geometry.map(point);
  const all = e.nodes?.map((id) => elements.get('node' + id)) ?? [];
  return all.every(Boolean) ? all.map(point) : [];
};
const key = (p) => p.join(',');
const closed = (line) => line.length >= 4 && key(line[0]) === key(line.at(-1));
function stitch(lines) {
  const rings = [];
  while (lines.length) {
    let line = lines.pop();
    while (!closed(line)) {
      const head = key(line[0]);
      const tail = key(line.at(-1));
      const index = lines.findIndex((part) => [key(part[0]), key(part.at(-1))].some((end) => end === head || end === tail));
      if (index === -1) break;
      let [part] = lines.splice(index, 1);
      if ([key(part[0]), key(part.at(-1))].includes(tail)) {
        if (key(part[0]) !== tail) part.reverse();
        line = line.concat(part.slice(1));
      } else {
        if (key(part.at(-1)) !== head) part.reverse();
        line = part.concat(line.slice(1));
      }
    }
    if (closed(line)) rings.push(line);
  }
  return rings;
}

function layer(tags, isArea) {
  if (isArea && tags.building && tags.building !== 'no') return 'building';
  if (isArea && tags['building:part'] && tags['building:part'] !== 'no') return 'part';
  if (isArea && (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir')) return 'water';
  if (isArea && (tags.leisure || tags.landuse || tags.natural || tags.area === 'yes' || tags.amenity === 'parking')) return 'terrain';
  if (tags.highway && !['proposed', 'construction', 'abandoned', 'platform'].includes(tags.highway)) return 'road';
  if (tags.railway && !['proposed', 'construction', 'abandoned', 'dismantled', 'platform'].includes(tags.railway)) return 'rail';
  if (tags.waterway && ['river', 'stream', 'canal', 'drain'].includes(tags.waterway)) return 'waterline';
}
const keep = new Set(['name','name:en','building','building:part','building:levels','building:material','height',
  'min_height','roof:height','roof:shape','roof:material','man_made','highway','surface','bridge','tunnel','layer',
  'leisure','natural','landuse','amenity','water','waterway','railway','service','width','lanes','area','sport','denotation']);
const simplify = (tags) => Object.fromEntries(Object.entries(tags).filter(([key]) => keep.has(key)));
const map = { attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0',
  licenseUrl: 'https://www.openstreetmap.org/copyright', sourceTime: sourceTime || null, bounds: region.bounds,
  source: args.map((arg) => arg.split(/[\\/]/).at(-1)), features: [] };
const relationWays = new Map();
const candidates = [];

for (const e of elements.values()) {
  if (e.type !== 'relation' || e.tags?.type !== 'multipolygon') continue;
  const kind = layer(e.tags, true);
  if (!kind || !['building', 'part', 'terrain', 'water'].includes(kind)) continue;
  const memberPoints = (member) => {
    if (member.geometry) return member.geometry.map(point);
    const way = elements.get('way' + member.ref);
    return way ? wayPoints(way) : [];
  };
  const members = e.members.filter((member) => member.type === 'way');
  const outer = stitch(members.filter((m) => m.role !== 'inner').map(memberPoints).filter((line) => line.length));
  if (!outer.length) continue;
  const inner = stitch(members.filter((m) => m.role === 'inner').map(memberPoints).filter((line) => line.length));
  map.features.push({ id: 'r' + e.id, kind, tags: simplify(e.tags), points: outer.concat(inner) });
  for (const member of members) {
    const kinds = relationWays.get(member.ref) ?? new Set();
    kinds.add(kind);
    relationWays.set(member.ref, kinds);
  }
}

for (const e of elements.values()) {
  const tags = e.tags || {};
  const xy = e.type === 'way' ? wayPoints(e) : [];
  const kind = layer(tags, closed(xy));
  if (e.type === 'way' && kind && xy.length >= 2 && !relationWays.get(e.id)?.has(kind)) {
    map.features.push({ id: 'w' + e.id, kind, tags: simplify(tags), points: [xy] });
  }
  if (e.type === 'node' && withinCoverage(e.lon, e.lat) && tags.natural === 'tree') {
    map.features.push({ id: 'n' + e.id, kind: 'tree', tags: simplify(tags), points: [[point(e)]] });
  }
  const label = tags.name || tags['addr:street'] || tags['addr:place'];
  if (!label) continue;
  const coords = e.type === 'node' ? point(e) : xy.length ? xy.reduce((sum, p) => [sum[0] + p[0] / xy.length, sum[1] + p[1] / xy.length], [0, 0]) : null;
  if (coords && withinCoverage(...coords)) candidates.push({ osm: e.type + '/' + e.id, label, coords, tags });
}
if (!map.features.length) throw new Error('Map source contained no renderable features.');
const out = new URL('../public/map/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('geometry.json', out), JSON.stringify(map));
await writeFile(resolve(process.env.OSTRAVA_CANDIDATES || join(process.cwd(), 'osm-candidates.json')), JSON.stringify(candidates));
console.log(map.features.reduce((counts, f) => ({ ...counts, [f.kind]: (counts[f.kind] ?? 0) + 1 }), {}));
