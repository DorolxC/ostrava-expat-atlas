import { readFile, writeFile } from 'node:fs/promises';
import { project, region } from '../public/js/geo.js';

const map = new URL('../public/map/', import.meta.url);
const read = (name) => readFile(new URL(name, map), 'utf8').then(JSON.parse);
const [{features}, {city}] = await Promise.all([read('geometry.json'), read('scene.json')]);
const central = process.argv.includes('--central');
const settings = { river: [14, 92], canal: [12, 40], stream: [10, 22] };
const inside = ([x,y]) => x >= city.left-140 && x <= city.right+140 && y >= city.top-140 && y <= city.bottom+140;
const distance = (a,b) => Math.hypot(b[0]-a[0], (b[1]-a[1])/region.pitch);
const round = (value, scale=10) => Math.round(value*scale)/scale;

function samplePath({points, step, reach, offset, phase}) {
  const lengths = [0];
  for (let i=1; i<points.length; i++) lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
  const end = lengths.at(-1);
  if (!end) return [];
  function point(at) {
    at=Math.min(end,Math.max(0,at));
    let low=0, high=lengths.length-1;
    while (high-low>1) {
      const middle=(high+low)>>1;
      if (lengths[middle]<at) low=middle;
      else high=middle;
    }
    const t=(at-lengths[low])/(lengths[high]-lengths[low] || 1);
    return points[low].map((value,axis)=>value+(points[high][axis]-value)*t);
  }
  const result = [];
  for (let at=step/2; at<end+step/2; at+=step) {
    const here=point(at);
    if (!inside(here)) continue;
    const prev=point(at-step);
    const next=point(at+step);
    const span=distance(prev,next);
    if (!span) continue;
    const ux=(next[0]-prev[0])/span;
    const uy=(next[1]-prev[1])/span;
    const back=Math.atan2(here[1]-prev[1],here[0]-prev[0]);
    const ahead=Math.atan2(next[1]-here[1],next[0]-here[0]);
    const turn=distance(here,prev)>1 && distance(here,next)>1 ? Math.sin(ahead-back) : 0;
    result.push([...here.map((v)=>round(v)),round(ux,1000),round(uy,1000),round(turn,1000),reach,
      Math.round(offset+at),phase]);
  }
  return result;
}

// OSM centerline ways are ordered from source to mouth. Raster pigment still
// determines where a water surface is visible, including beneath bridges.
const paths=[];
const downstream=new Map();
const names=new Set();
const nodeKey=([lon,lat])=>lon.toFixed(6)+','+lat.toFixed(6);
for (const feature of features) {
  const tags=feature.tags;
  if (feature.kind!=='waterline' || !(tags.waterway in settings) ||
      (tags.tunnel && tags.tunnel!=='no') || tags.covered==='yes' || tags.intermittent==='yes' ||
      (central && tags.name!=='Ostravice') ||
      (tags.waterway==='stream' && !tags.name && !(parseFloat(tags.width)>=3))) continue;
  const [step,range]=settings[tags.waterway];
  const width=parseFloat(tags.width);
  const reach=tags.waterway==='river' || !Number.isFinite(width) ? range : Math.min(range,Math.max(10,width+8));
  for (const points of feature.points) {
    if (points.length<2) continue;
    const projected=points.map(([lon,lat])=>project(lon,lat));
    let length=0;
    for (let i=1; i<projected.length; i++) length+=distance(projected[i-1],projected[i]);
    if (length<1) continue;
    const path={points:projected, step, reach, length, name:tags.name, channel:tags.waterway,
      phase:Number.parseInt(feature.id.slice(1),10)%113, first:nodeKey(points[0])};
    paths.push(path);
    const end=nodeKey(points.at(-1));
    const incoming=downstream.get(end) ?? [];
    incoming.push(path);
    downstream.set(end,incoming);
  }
}

function station(path, visiting=new Set()) {
  if (path.offset!==undefined) return path.offset;
  if (visiting.has(path)) return 0;
  visiting.add(path);
  let offset=0;
  for (const before of downstream.get(path.first) ?? []) {
    if (before.channel!==path.channel || (before.name && path.name && before.name!==path.name)) continue;
    const end=station(before,visiting)+before.length;
    if (end<=offset) continue;
    offset=end;
    path.phase=before.phase;
  }
  visiting.delete(path);
  path.offset=offset;
  return offset;
}

const samples=[];
for (const path of paths) {
  station(path);
  const picked=samplePath(path);
  if (picked.length && path.name) names.add(path.name);
  samples.push(...picked);
}
await writeFile(new URL('river-flow.json',map),JSON.stringify({version:2,samples}));
console.log(`Baked ${samples.length} current directions along ${names.size} named waterways${central?' (Ostravice pilot)':''}.`);

