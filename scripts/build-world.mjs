import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { project, region } from '../public/js/geo.js';
import { readPbf } from './data/osm-pbf.mjs';
import { bridgeDeck, isBelowSurface, offsetPath, roadWidth, transportGrade } from './transport.mjs';
import { activityGrid, polygonContains as inside } from './activity-grid.mjs';

const root=new URL('../public/map/',import.meta.url);
const source=process.argv[2] || process.env.OSTRAVA_OSM_PBF || new URL('./data/Ostrava.osm.pbf',import.meta.url);
const geographyBytes=await readFile(new URL('geometry.json',root));
const { features, sourceTime }=JSON.parse(geographyBytes);
const boundary=JSON.parse(await readFile(new URL('boundary.json',root),'utf8'));
const rawTags=new Map();
for (const object of readPbf(source)) if (object.type==='way' && object.tags?.highway) rawTags.set('w'+object.id,object.tags);

const limits=[
  ['centre','square',18.292470,49.835200,445,245,[[18.292356,49.835190],[18.292870,49.835506]]],
  ['park','park',18.290275,49.845435,370,255,[[18.289980,49.845335],[18.289400,49.846535],[18.291150,49.843290]]],
  ['river','river',18.295100,49.839400,375,235,[[18.295130,49.839095],[18.294480,49.840805]]],
  ['poruba','street',18.17550,49.82520,485,308,[[18.17466,49.82892]]],
  ['ironworks','industrial',18.27810,49.81950,420,253,[]],
  ['nova-bela','residential',18.26053,49.75058,340,212,[]],
  ['jih','residential',18.24660,49.78895,398,245,[]],
  ['slezska','residential',18.30132,49.83970,330,242,[]],
  ['privoz','street',18.26886,49.85010,330,231,[]],
  ['marianske-hory','street',18.23920,49.84365,380,223,[[18.24050,49.84413]]],
];
const pitch=region.pitch;
const dist=(a,b)=>Math.hypot(b[0]-a[0],(b[1]-a[1])/pitch);
const move=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const tenth=(p)=>p.map(v=>Math.round(v*10)/10);
const extent=(points)=>points.reduce(([l,t,r,b],[x,y])=>[Math.min(l,x),Math.min(t,y),Math.max(r,x),Math.max(b,y)],[Infinity,Infinity,-Infinity,-Infinity]);
const intersects=([l,t,r,b],[x,y,ex,ey])=>l<=ex && x<=r && t<=ey && y<=b;
const insideBox=(x,y,[l,t,r,b],pad=0)=>x>=l+pad && x<=r-pad && y>=t+pad && y<=b-pad;
const ringsOf=(f)=>f.points.map(ring=>ring.map(p=>project(...p)));
const city=boundary.geometry.coordinates.flat().map(ring=>ring.map(p=>project(...p)));

const regions=limits.map(([id,kind,lon,lat,w,h,birds])=>{
  const [x,y]=project(lon,lat);
  return {id,kind,anchor:tenth([x,y]),bounds:[Math.floor(x-w),Math.floor(y-h),Math.ceil(x+w),Math.ceil(y+h)],
    birds:birds.map(p=>tenth(project(...p))),routes:[]};
});
const roads=[];
for (const feature of features) {
  const tags=feature.kind==='road' && rawTags.get(feature.id);
  if (!tags) continue;
  const modes=kinds(tags);
  if (!modes.length) continue;
  const [line]=ringsOf(feature);
  if (line.length>1) roads.push({id:feature.id,tags,modes,line});
}
const {habitatAt,areas:discovered}=activityGrid(features,roads,city);
regions.push(...discovered);
const blockGrid=new Map();
const cell=48;
for (const f of features) {
  if (!['building','part','water'].includes(f.kind) || (!f.points.length)) continue;
  const rings=ringsOf(f);
  const extentBox=extent(rings.flat());
  if (!regions.some(({bounds})=>intersects(bounds,extentBox))) continue;
  const [l,t,r,b]=extentBox;
  for (let y=Math.floor(t/cell);y<=Math.floor(b/cell);y++) for (let x=Math.floor(l/cell);x<=Math.floor(r/cell);x++) {
    const key=x+','+y;
    if (!blockGrid.has(key)) blockGrid.set(key,[]);
    blockGrid.get(key).push(rings);
  }
}

function surface(x,y) {
  const blockers=blockGrid.get(Math.floor(x/cell)+','+Math.floor(y/cell));
  return !blockers?.some(rings=>inside(rings,x,y));
}

function room([x,y], radius) {
  return surface(x,y) && surface(x-radius,y) && surface(x+radius,y) &&
    surface(x,y-radius*pitch) && surface(x,y+radius*pitch);
}

function kinds(tags) {
  const driving=/^(primary|secondary|tertiary|residential|unclassified|living_street)$/;
  const sidewalk=/^(footway|pedestrian|path)$/;
  const denied=/^(no|private|customers|permit|agricultural|forestry|destination|delivery|dismount|use_sidepath)$/;
  const allowed=key=>!denied.test(tags[key] ?? (key==='foot'?undefined:tags.vehicle) ?? tags.access ?? '') &&
    !tags[`${key}:conditional`] && !tags['access:conditional'];
  const positive=tag=>tag==='yes' || tag==='designated' || tag==='permissive';
  if (transportGrade(tags)!==0 || isBelowSurface(tags) || bridgeDeck(tags) || (tags.tunnel && tags.tunnel!=='no') || tags.area==='yes') return [];
  const modes=[];
  const shared=['cycleway','track','bridleway'].includes(tags.highway) && positive(tags.foot);
  if ((sidewalk.test(tags.highway) || shared) && allowed('foot') && tags.footway!=='crossing') modes.push('walker');
  if (driving.test(tags.highway) && allowed('motor_vehicle') && allowed('motorcar')) modes.push('car');
  if ((tags.highway==='cycleway' || (sidewalk.test(tags.highway) || tags.highway==='track') && positive(tags.bicycle)) &&
    allowed('bicycle') && !/sand|mud|grass/.test(tags.surface??'')) modes.push('cycle');
  return modes;
}

function wayDirection(tags,mode) {
  const name=mode==='cycle' ? 'bicycle' : mode==='walker' ? 'foot' : 'motor_vehicle';
  if (tags['oneway:conditional'] || tags[`oneway:${name}:conditional`]) return null;
  const value=tags[`oneway:${name}`] ?? (mode==='walker' ? undefined : tags.oneway);
  if (['yes','true','1'].includes(value)) return 1;
  if (value==='-1' || value==='reverse') return -1;
  if (['no','false','0'].includes(value)) return 0;
  return value===undefined ? mode!=='walker' && tags.junction==='roundabout' ? 1 : 0 : null;
}

function roundCorners(points,cut) {
  const result=[points[0]];
  for (let i=1;i<points.length-1;i++) {
    const b=points[i],a=points[i-1],c=points[i+1];
    const ab=dist(a,b),bc=dist(b,c);
    if (ab<.01 || bc<.01) continue;
    const p=move(b,a,Math.min(.24,cut/ab)),q=move(b,c,Math.min(.24,cut/bc));
    result.push(p,move(move(p,b,.5),move(b,q,.5),.5),q);
  }
  result.push(points.at(-1));
  return result;
}

// A sampled route can stop at the edge of the authored activity area or at a
// source obstruction. Split there so no hidden leg need cross water or a wall.
function segments(path,bounds,margin,limit,qualifies) {
  const result=[];
  let current=[],length=0;
  const flush=()=>{
    if (length>=limit) result.push({points:current,length});
    current=[];
    length=0;
  };
  for (let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i];
    if (!intersects(extent([a,b]),bounds)) {flush();continue;}
    const count=Math.max(1,Math.ceil(dist(a,b)/1.4));
    for (let j=i===1 ? 0 : 1;j<=count;j++) {
      const p=move(a,b,j/count);
      if (!insideBox(p[0],p[1],bounds,22) || !room(p,margin) || !inside(city,...p) || !qualifies(...p)) {flush();continue;}
      const last=current.at(-1);
      if (last && dist(last,p)>2.3) flush();
      if (current.length) length+=dist(current.at(-1),p);
      current.push(p);
    }
  }
  flush();
  return result;
}

function quantizePath(path) {
  const unique=[];
  for (const point of path.map(tenth)) if (!unique.length || dist(point,unique.at(-1))>.07) unique.push(point);
  return unique;
}

const candidates=new Map(regions.map(r=>[r.id,[]]));
const laneDistance=(tags,kind)=>kind==='car' ? Math.min(1.64,roadWidth(tags)*.22) : kind==='cycle' ? Math.min(.55,roadWidth(tags)*.18) : 0;
for (const {id,tags,modes,line} of roads) {
  const e=extent(line);
  const areas=regions.filter(({bounds})=>intersects(bounds,e));
  if (!areas.length) continue;
  for (const kind of modes) {
    const direction=wayDirection(tags,kind);
    if (direction===null) continue;
    const directions=kind==='walker' ? [direction || 1] : direction===0 ? [1,-1] : [direction];
    for (const travel of directions) {
      const ordered=travel===1 ? line : [...line].reverse();
      const lane=kind==='car' && direction!==0 && (roadWidth(tags)<4.8 || tags.lanes==='1') ? 0 : laneDistance(tags,kind);
      const points=roundCorners(lane ? offsetPath(ordered,lane) : ordered,kind==='car' ? 2.3 : kind==='cycle' ? 1.2 : .7);
      for (const area of areas) {
        if (area.core && kind==='car' && ['wood','park'].includes(area.kind)) continue;
        const minimum=kind==='car' ? 54 : kind==='cycle' ? 43 : 24;
        const qualifies=area.core ? (x,y)=>habitatAt(x,y)!=='restricted' : ()=>true;
        const routes=segments(points,area.bounds,kind==='car'?1.15:kind==='cycle'?.59:.38,minimum,qualifies);
        for (const route of routes) {
          if (route.length>265) {
            let index=0,d=0;
            while (index<route.points.length-1 && d<(route.length-245)*.5) {d+=dist(route.points[index],route.points[index+1]);index++;}
            route.points=route.points.slice(index,index+Math.round(245/1.25));
          }
          const path=quantizePath(route.points);
          if (path.length<2) continue;
          const center=path[Math.floor(path.length/2)];
          if (area.core && !insideBox(...center,area.core)) continue;
          const habitat=area.core && habitatAt(...center);
          const square=area.kind==='square' && kind==='walker';
          const score=Math.min(160,route.length)*.49-dist(area.anchor,center)*.68+
            (square && tags.highway==='pedestrian' ? 47 : 0)+(kind==='cycle' && tags.highway==='cycleway' ? 18 : 0)+
            (area.core && habitat===area.kind && habitat!=='street' ? 42 : 0);
          candidates.get(area.id).push({kind,id,points:path,score,travel,oneway:direction,
            highway:tags.highway,street:tags.name || undefined});
        }
      }
    }
  }
}

const owned=new Map();
for (const area of regions) {
  const list=candidates.get(area.id).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id) || b.travel-a.travel);
  const max=area.core ? [area.kind==='street'?2:3,1,2] : area.kind==='square' || area.kind==='park' ? [5,2,2] : [3,3,2];
  for (const [i,mode] of ['walker','car','cycle'].entries()) {
    let count=0;
    for (const {score,...route} of list) {
      if (count===max[i] || route.kind!==mode || route.points.length<2) continue;
      const key=route.kind+'/'+route.id;
      const center=route.points[Math.floor(route.points.length/2)];
      const previous=owned.get(key)??[];
      if (previous.some(p=>!area.core || dist(p,center)<(mode==='walker'?110:180))) continue;
      previous.push(center);
      owned.set(key,previous);
      count++;
      area.routes.push(route);
    }
  }
  if (area.core && ['park','wood','river'].includes(area.kind) && area.routes.length) {
    const perches=[area.anchor,...area.routes.filter(({kind})=>kind!=='car').map(({points})=>points[Math.floor(points.length/2)])];
    area.birds=perches.filter((point,i)=>habitatAt(...point)===area.kind &&
      insideBox(...point,area.bounds,58) && perches.slice(0,i).every(other=>dist(other,point)>70)).slice(0,2).map(tenth);
  }
  area.anchor=tenth(area.anchor);
  area.birds=area.birds.filter(p=>room(p,1) && inside(city,...p));
  console.log(area.id+': '+area.routes.map(r=>r.kind+' '+r.id).join(', ')+' / '+area.birds.length+' bird sites');
}

const populated=regions.filter(area=>area.routes.length || area.birds.length).map(({id,kind,anchor,bounds,routes,birds})=>
  ({id,kind,anchor,bounds,routes,birds}));
const revision=createHash('sha256').update(JSON.stringify(populated)).digest('hex').slice(0,16);
await writeFile(new URL('world-routes.json',root),JSON.stringify({version:1,sourceTime,revision,
  geometry:createHash('sha256').update(geographyBytes).digest('hex'),regions:populated}));
