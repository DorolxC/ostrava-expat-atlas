import { readFileSync, writeFileSync } from 'node:fs';
import { readPbf } from './osm-pbf.mjs';

const directory = new URL('./', import.meta.url);
const source = 'https://download.bbbike.org/osm/bbbike/Ostrava/Ostrava.osm.pbf';
const sourceBoundary = 'https://www.openstreetmap.org/relation/437354';
const licenseUrl = 'https://www.openstreetmap.org/copyright';
const attribution = '© OpenStreetMap contributors';
const license = 'ODbL-1.0';
const renderBounds = [18.074, 49.711, 18.401, 49.928];
const boundsTest = (x, y, bounds = renderBounds) => x >= bounds[0] && y >= bounds[1] && x <= bounds[2] && y <= bounds[3];
const candidates = [];
const features = [];
const ways = new Map();
const relations = [];
const nodes = new Map();
let sourceTime;

function box(points) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [x, y] of points) {
    if (x < west) west = x;
    if (y < south) south = y;
    if (x > east) east = x;
    if (y > north) north = y;
  }
  return [west, south, east, north];
}

function overlaps(a, b = renderBounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

const obscured = new Set(['proposed', 'construction', 'abandoned', 'dismantled', 'platform']);
const waterLines = new Set(['river', 'stream', 'canal', 'drain', 'ditch']);
const structures = new Set(['chimney', 'tower', 'crane', 'works', 'water_tower', 'silo', 'storage_tank']);
const closed = (list) => list.length >= 4 && list[0] === list.at(-1);
const present = (value) => value && value !== 'no';
const keep = new Set([
  'name', 'name:en', 'building', 'building:part', 'building:levels', 'building:material',
  'building:colour', 'building:min_level', 'height', 'min_height', 'roof:height',
  'roof:shape', 'roof:material', 'roof:colour', 'roof:direction', 'roof:orientation',
  'roof:levels', 'roof:angle', 'man_made', 'tower:type', 'tower:construction',
  'highway', 'junction', 'surface', 'bridge', 'bridge:structure', 'tunnel', 'layer',
  'leisure', 'natural', 'landuse', 'landcover', 'amenity', 'water', 'waterway', 'railway',
  'service', 'width', 'lanes', 'area', 'sport', 'denotation', 'material', 'location',
  'circumference', 'diameter', 'diameter_crown', 'leaf_type', 'leaf_cycle',
  'historic', 'shelter_type', 'power', 'covered', 'embankment',
]);
const simplify = (tags) => Object.fromEntries(Object.entries(tags).filter(([key]) => keep.has(key)));
const pointBearingStructure = (tags) => structures.has(tags?.man_made);
const relevantName = (tags) => /Katedrála Božského|Nová radnice|stará radnice|Ostravské muzeum|Gong|Bolt Tower|vysoká pec|plynojem|oblouk|Cineport|Ostravar Aréna|Slezskoostravský hrad|Landek|Bazaly|Památník Rudé armády|Halda Ema|Vysoké pece|Poruba/i.test(tags?.name || '');

function layer(tags, isArea) {
  if (!tags) return;
  if (isArea && present(tags['building:part'])) return 'part';
  if (isArea && present(tags.building)) return 'building';
  if (isArea && (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir')) return 'water';
  if (isArea && (tags.leisure || tags.landuse || tags.natural || tags.landcover || tags.area === 'yes' || tags.amenity === 'parking')) return 'terrain';
  if (tags.natural === 'tree_row') return 'treeline';
  if (tags.highway && !obscured.has(tags.highway)) return 'road';
  if (tags.railway && !obscured.has(tags.railway)) return 'rail';
  if (waterLines.has(tags.waterway)) return 'waterline';
}

function stitch(segments) {
  const open = segments.map((vertices) => vertices.slice());
  const complete = [];
  while (open.length) {
    let ring = open.pop();
    while (!closed(ring)) {
      const first = ring[0];
      const last = ring.at(-1);
      const index = open.findIndex((segment) => [segment[0], segment.at(-1)].some((vertex) => vertex === first || vertex === last));
      if (index < 0) break;
      const [segment] = open.splice(index, 1);
      if (segment[0] === last || segment.at(-1) === last) {
        if (segment[0] !== last) segment.reverse();
        ring = ring.concat(segment.slice(1));
      } else {
        if (segment.at(-1) !== first) segment.reverse();
        ring = segment.concat(ring.slice(1));
      }
    }
    if (closed(ring)) complete.push(ring);
  }
  return complete;
}

const boundaryResponse = JSON.parse(readFileSync(new URL('boundary-osm.json', directory), 'utf8'));
const boundary = boundaryResponse.elements.find((item) => item.type === 'relation' && item.id === 437354);
const boundaryNodes = new Map(boundaryResponse.elements.filter((item) => item.type === 'node').map((item) => [item.id, [item.lon, item.lat]]));
const boundaryWays = new Map(boundaryResponse.elements.filter((item) => item.type === 'way').map((item) => [item.id, item.nodes]));
const boundaryRings = stitch(boundary.members.filter((member) => member.type === 'way' && member.role === 'outer').map((member) => boundaryWays.get(member.ref))).map((ring) => ring.map((id) => boundaryNodes.get(id)));
if (!boundaryRings.length) throw new Error('Municipality relation lacks a complete outer boundary');
const boundaryBbox = box(boundaryRings.flat());
const municipal = {
  type: 'Feature',
  id: 'r437354',
  bbox: boundaryBbox,
  properties: { name: 'Ostrava', source: sourceBoundary, attribution, license, licenseUrl, version: boundary.version },
  geometry: { type: 'MultiPolygon', coordinates: boundaryRings.map((ring) => [ring]) },
};
writeFileSync(new URL('boundary.geojson', directory), JSON.stringify(municipal));

const average = (points) => {
  const [x, y] = points.reduce(([x, y], p) => [x + p[0], y + p[1]], [0, 0]);
  return [+(x / points.length).toFixed(7), +(y / points.length).toFixed(7)];
};

const addCandidate = (id, tags, point) => {
  if (boundsTest(...point)) candidates.push({ id, name: tags.name ?? '', point, tags: simplify(tags) });
};

for (const entity of readPbf(new URL('Ostrava.osm.pbf', directory))) {
  const { type, id, point, tags } = entity;
  if (type === 'header') {
    sourceTime = sourceTime ?? entity.timestamp;
  } else if (type === 'node') {
    nodes.set(id, point);
    if (!tags || !boundsTest(...point)) continue;
    if (tags.natural === 'tree') features.push({ id: 'n' + id, kind: 'tree', tags: simplify(tags), points: [[point]] });
    if (pointBearingStructure(tags)) features.push({ id: 'n' + id, kind: 'structure', tags: simplify(tags), points: [[point]] });
    if (relevantName(tags) || pointBearingStructure(tags)) addCandidate('n' + id, tags, point);
  } else if (type === 'way') {
    ways.set(id, entity);
  } else if (type === 'relation') {
    relations.push(entity);
  }
}

const consumed = new Map();
for (const { id, tags, members } of relations) {
  if (tags?.type !== 'multipolygon') continue;
  const kind = layer(tags, true);
  if (!['building', 'part', 'terrain', 'water'].includes(kind)) continue;
  const pieces = members.filter((member) => member.type === 'way' && ways.has(member.ref));
  const rings = (inner) => stitch(pieces.filter((member) => (member.role === 'inner') === inner)
    .map((member) => ways.get(member.ref).refs))
    .filter((ring) => ring.every((node) => nodes.has(node))).map((ring) => ring.map((node) => nodes.get(node)));
  const outer = rings(false);
  if (!outer.length || !overlaps(box(outer.flat()))) continue;
  const points = [...outer, ...rings(true)];
  features.push({ id: 'r' + id, kind, tags: simplify(tags), points });
  if (relevantName(tags) || pointBearingStructure(tags)) addCandidate('r' + id, tags, average(outer[0]));
  for (const member of pieces) {
    const memberTags = ways.get(member.ref).tags;
    // A paved service area may describe the contents of a hole in a land-cover polygon.
    if (kind === 'terrain' && member.role === 'inner' && tags.highway !== 'service' &&
        memberTags?.highway === 'service' && memberTags.area === 'yes') continue;
    if (!consumed.has(member.ref)) consumed.set(member.ref, new Set());
    consumed.get(member.ref).add(kind);
  }
}

for (const { id, tags, refs } of ways.values()) {
  const kind = layer(tags, closed(refs));
  const named = relevantName(tags);
  const structure = pointBearingStructure(tags);
  if (!kind && !named && !structure) continue;
  const points = refs.map((node) => nodes.get(node));
  if (points.length < 2 || points.some((p) => !p) || !overlaps(box(points))) continue;
  if (kind && !consumed.get(id)?.has(kind)) features.push({ id: 'w' + id, kind, tags: simplify(tags), points: [points] });
  // A tagged tower footprint is retained even when no explicit node is mapped.
  if (structure && !kind) features.push({ id: 'w' + id, kind: 'structure', tags: simplify(tags), points: [[average(points)]] });
  if (named || structure) addCandidate('w' + id, tags, average(closed(refs) ? points.slice(0, -1) : points));
}

const map = {
  attribution, license, licenseUrl, sourceTime: sourceTime ?? null,
  bounds: renderBounds, source: [source],
  features,
};
const counts = features.reduce((counts, feature) => { counts[feature.kind] = (counts[feature.kind] ?? 0) + 1; return counts; }, {});
console.log({
  sourceTime, boundaryBbox, renderBounds, nodes: nodes.size, ways: ways.size,
  features: counts,
});
writeFileSync(new URL('geometry.json', directory), JSON.stringify(map));
writeFileSync(new URL('landmark-candidates.json', directory), JSON.stringify(candidates, null, 2));

