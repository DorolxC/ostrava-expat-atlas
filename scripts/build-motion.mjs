import { readFile, writeFile } from 'node:fs/promises';
import { project, region } from '../public/js/geo.js';

const map = new URL('../public/map/', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, map), 'utf8'));
const [{ features }, boundary, street] = await Promise.all([read('geometry.json'), read('boundary.json'), read('street-detail.json')]);
const pitch = region.pitch;
const rounded = (value) => Math.round(value * 10) / 10;
const length = (a, b) => Math.hypot(b[0] - a[0], (b[1] - a[1]) / pitch);
const positiveTag = (value) => value && value !== 'no';
const projectRings = (rings) => rings.map((ring) => ring.map((point) => project(...point)));
const city = projectRings(boundary.geometry.coordinates.flat());

function contains(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
    }
  }
  return inside;
}

function grid(cellSize) {
  const indexed = new Map();
  const key = (x, y) => x + ',' + y;
  return {
    add(left, top, right, bottom, value) {
      for (let y = Math.floor(top / cellSize); y <= Math.floor(bottom / cellSize); y++) {
        for (let x = Math.floor(left / cellSize); x <= Math.floor(right / cellSize); x++) {
          const id = key(x, y);
          const cell = indexed.get(id) ?? [];
          cell.push(value);
          indexed.set(id, cell);
        }
      }
    },
    at(x, y) {
      return indexed.get(key(Math.floor(x / cellSize), Math.floor(y / cellSize))) ?? [];
    },
    * along(a, b) {
      const seen = new Set();
      for (let y=Math.floor(Math.min(a[1],b[1])/cellSize); y<=Math.floor(Math.max(a[1],b[1])/cellSize); y++) {
        for (let x=Math.floor(Math.min(a[0],b[0])/cellSize); x<=Math.floor(Math.max(a[0],b[0])/cellSize); x++) {
          for (const item of indexed.get(key(x,y)) ?? []) {
            if (seen.has(item)) continue;
            seen.add(item);
            yield item;
          }
        }
      }
    },
  };
}

const foreground = grid(48);
const crossings = grid(96);
const streetsWithTraffic = /^(trunk|primary|secondary|tertiary)(_link)?$|^residential$/;
const separated = (tags) => positiveTag(tags.bridge) || positiveTag(tags.tunnel) ||
  tags.covered==='yes' || (Number(tags.layer) || 0)!==0;
for (const f of features) {
  if (f.kind==='road' && streetsWithTraffic.test(f.tags.highway) && !separated(f.tags)) {
    for (const route of projectRings(f.points)) {
      for (let i=1; i<route.length; i++) {
        const a=route[i-1], b=route[i];
        crossings.add(Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.max(a[0],b[0]), Math.max(a[1],b[1]), [a,b]);
      }
    }
  }
  if (f.kind !== 'building' && f.kind !== 'part') continue;
  const rings = projectRings(f.points);
  const tagHeight = parseFloat(f.tags.height);
  const levels = parseFloat(f.tags['building:levels']);
  const known = tagHeight || (levels > 0 ? levels * 3.2 : 9.5);
  const rise = Math.min(130, known) * Math.sqrt(1 - pitch ** 2);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  foreground.add(left, top - rise, right, bottom, { rings, left, top: top - rise, right, bottom, rise });
}

const stops = grid(48);
const fountains = [];
for (const point of street.points) {
  if (point.tags.kind!=='tram-stop' && point.tags.kind!=='fountain') continue;
  const xy=project(...point.points[0][0]);
  const [x,y]=xy;
  if (!contains(city,x,y)) continue;
  if (point.tags.kind==='fountain') fountains.push(xy.map(rounded));
  else stops.add(x-14,y-14*pitch,x+14,y+14*pitch,xy);
}

function covers(x, y, baseY) {
  for (const { rings, left, top, right, bottom, rise } of foreground.at(x, y)) {
    if (x < left || x > right || y < top || y > bottom || baseY >= bottom) continue;
    const crossings = [];
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1];
        const [bx, by] = ring[i];
        if ((ax > x) !== (bx > x)) crossings.push(ay + (by - ay) * (x - ax) / (bx - ax));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i < crossings.length - 1; i += 2) {
      if (y >= crossings[i] - rise && y <= crossings[i + 1] && baseY < crossings[i + 1]) return true;
    }
  }
  return false;
}

const trackNodes = [];
const trackEdges = [];
const trackIDs = new Map();
const gradeSeparatedEdges = new Set();
const edgeKey = (a,b) => Math.min(a,b)+','+Math.max(a,b);
function trackNode(point) {
  const key = point.map((n) => n.toFixed(6)).join(',');
  if (trackIDs.has(key)) return trackIDs.get(key);
  const id = trackNodes.length;
  trackIDs.set(key, id);
  trackNodes.push(project(...point));
  trackEdges.push([]);
  return id;
}
for (const f of features) {
  if (f.kind !== 'rail' || f.tags.railway !== 'tram' || positiveTag(f.tags.tunnel)) continue;
  for (const path of f.points) {
    for (let i = 1; i < path.length; i++) {
      const a = trackNode(path[i - 1]);
      const b = trackNode(path[i]);
      if (a === b) continue;
      const distance = length(trackNodes[a], trackNodes[b]);
      trackEdges[a].push([b, distance]);
      trackEdges[b].push([a, distance]);
      if (separated(f.tags)) gradeSeparatedEdges.add(edgeKey(a,b));
    }
  }
}

function nearestNodes(point) {
  const track = project(...point);
  return trackNodes.map((node, id) => [id, length(track, node)])
    .filter(([, distance]) => distance < 160)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 12);
}

function connect(start, end) {
  const from = nearestNodes(start);
  const to = nearestNodes(end);
  if (!from.length || !to.length) return [];
  const targets = new Map(to);
  const distance = new Float64Array(trackNodes.length).fill(Infinity);
  const previous = new Int32Array(trackNodes.length).fill(-1);
  const settled = new Uint8Array(trackNodes.length);
  for (const [node, gap] of from) distance[node] = gap * 3;
  let best = Infinity;
  let finish = -1;
  for (;;) {
    let node = -1;
    let current = Infinity;
    for (let i = 0; i < distance.length; i++) {
      if (!settled[i] && distance[i] < current) {
        node = i;
        current = distance[i];
      }
    }
    if (node < 0 || current >= best) break;
    settled[node] = 1;
    if (targets.has(node) && current + targets.get(node) * 3 < best) {
      finish = node;
      best = current + targets.get(node) * 3;
    }
    for (const [next, step] of trackEdges[node]) {
      if (current + step < distance[next]) {
        distance[next] = current + step;
        previous[next] = node;
      }
    }
  }
  const route = [];
  for (let id = finish; id >= 0; id = previous[id]) route.push(id);
  return route.reverse();
}

function streetJoint(a,b,c,d) {
  const ex=b[0]-a[0], ey=b[1]-a[1];
  const fx=d[0]-c[0], fy=d[1]-c[1];
  const cross=ex*fy-ey*fx;
  if (Math.abs(cross)<Math.hypot(ex,ey)*Math.hypot(fx,fy)*.38) return;
  const dx=c[0]-a[0], dy=c[1]-a[1];
  const railAt=(dx*fy-dy*fx)/cross;
  const streetAt=(dx*ey-dy*ex)/cross;
  return railAt>=0 && railAt<=1 && streetAt>=0 && streetAt<=1 ? railAt : undefined;
}

function sampleTrack(path, interval) {
  let remaining = 0;
  let travelled = 0;
  const samples = [];
  const triggers = [];
  const closestStops = new Map();
  for (let i = 1; i < path.length; i++) {
    const a = trackNodes[path[i - 1]];
    const b = trackNodes[path[i]];
    const distance = length(a, b);
    if (distance === 0) continue;
    if (!gradeSeparatedEdges.has(edgeKey(path[i-1],path[i]))) {
      for (const [c,d] of crossings.along(a,b)) {
        const t=streetJoint(a,b,c,d);
        if (t!==undefined) triggers.push([travelled+t*distance,0]);
      }
    }
    let at = remaining;
    for (; at < distance; at += interval) {
      const t = at / distance;
      const x = a[0] + t * (b[0] - a[0]);
      const y = a[1] + t * (b[1] - a[1]);
      const visible = Number(contains(city, x, y) && !covers(x, y - 1.2, y + 1.25));
      samples.push([rounded(x), rounded(y), visible]);
      for (const stop of stops.at(x,y)) {
        const gap=length(stop,[x,y]);
        if (gap<12 && gap<(closestStops.get(stop)?.gap ?? Infinity)) {
          closestStops.set(stop,{gap,at:travelled+at});
        }
      }
    }
    remaining = at - distance;
    travelled+=distance;
  }
  for (const stop of closestStops.values()) triggers.push([stop.at,1]);
  triggers.sort((a,b)=>a[0]-b[0]);
  const controls=[];
  for (const [at,type] of triggers) {
    if (at<23 || at>(samples.length-1)*interval-23) continue;
    const last=controls.at(-1);
    if (last && at-last[0]<25) {
      if (type>last[1]) controls[controls.length-1]=[Math.round(at),type];
    } else controls.push([Math.round(at),type]);
  }
  return {points:samples,controls};
}

// Endpoints select scenic stretches of track. These are illustrative runs with no timetable data.
const corridors = [
  ['centre', [18.280192, 49.846250], [18.292338, 49.832567]],
  ['vitkovice', [18.285257, 49.832447], [18.266337, 49.800267]],
  ['poruba', [18.164368, 49.831257], [18.176802, 49.834739]],
  ['poruba-east', [18.176940, 49.834525], [18.213031, 49.823906]],
  ['jih', [18.231698, 49.793777], [18.253377, 49.798637]],
  ['marianske-hory', [18.254466, 49.827546], [18.277067, 49.831118]],
];
const step = 5;
const tracks = corridors.flatMap(([name, start, end]) => {
  const {points,controls} = sampleTrack(connect(start, end), step);
  if (points.length < 48) {
    console.warn('Could not connect the tram corridor', name);
    return [];
  }
  return [{ name, points, controls }];
});
if (tracks.length < 3) throw new Error('Too few connected tram corridors');
await writeFile(new URL('motion.json', map), JSON.stringify({ tracks, step, fountains }));
console.log(`Motion atlas: ${tracks.length} tram corridors, ${tracks.reduce((count,t)=>count+t.controls.length,0)} crossings or stops and ${fountains.length} fountains.`);
