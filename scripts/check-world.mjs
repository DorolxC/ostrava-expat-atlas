import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { project, region } from '../public/js/geo.js';
import { readPbf } from './data/osm-pbf.mjs';

const location=new URL('../public/map/',import.meta.url);
const [geo,roads,depth,scene]=await Promise.all(['geometry.json','world-routes.json','world-depth.json','scene.json'].map(name=>readFile(new URL(name,location))));
const {features}=JSON.parse(geo);
const routes=JSON.parse(roads);
const mask=JSON.parse(depth);
const manifest=JSON.parse(scene);
assert.equal(routes.version,1);
assert.equal(mask.version,2);
assert.equal(mask.tileRevision,manifest.tileRevision);
assert.equal(routes.geometry,createHash('sha256').update(geo).digest('hex'));
assert.equal(mask.geometry,routes.geometry);
assert.equal(routes.regions.length,mask.fields.length);
const pitch=region.pitch;
const clearance={walker:.68,cycle:1.20,car:2.22};
const pitchDistance=(a,b)=>Math.hypot(b[0]-a[0],(b[1]-a[1])/pitch);
const boxes=routes.regions.map(({bounds})=>bounds);
const allRoutes=routes.regions.flatMap(place=>place.routes);
const ways=new Set(allRoutes.map(({id})=>id));
const streets=new Map();
const obstruction=new Map();
const cell=36;
for (const feature of features) {
  if (ways.has(feature.id) && feature.kind==='road') streets.set(feature.id,feature.points[0].map(p=>project(...p)));
  if (!['building','part','water'].includes(feature.kind)) continue;
  const rings=feature.points.map(ring=>ring.map(p=>project(...p)));
  const [l,t,r,b]=rings.flat().reduce(([l,t,r,b],[x,y])=>[Math.min(l,x),Math.min(t,y),Math.max(r,x),Math.max(b,y)],[Infinity,Infinity,-Infinity,-Infinity]);
  if (!boxes.some(([x,y,X,Y])=>x<r && X>l && y<b && Y>t)) continue;
  for (let y=Math.floor(t/cell);y<=Math.floor(b/cell);y++) for (let x=Math.floor(l/cell);x<=Math.floor(r/cell);x++) {
    const key=x+','+y;
    if (!obstruction.has(key)) obstruction.set(key,[]);
    obstruction.get(key).push({id:feature.id,rings});
  }
}

function covers(rings,x,y) {
  let inside=false;
  for (const ring of rings) for (let i=1;i<ring.length;i++) {
    const [ax,ay]=ring[i-1],[bx,by]=ring[i];
    if ((ay>y)!==(by>y) && x<ax+(bx-ax)*(y-ay)/(by-ay)) inside=!inside;
  }
  return inside;
}

function nearest(line,[x,y]) {
  let best=Infinity,at=0,station=0;
  for (let i=1;i<line.length;i++) {
    const [ox,oy]=line[i-1];
    const sx=line[i][0]-ox,sy=(line[i][1]-oy)/pitch;
    const sq=sx*sx+sy*sy;
    if (!sq) continue;
    const tx=x-ox,ty=(y-oy)/pitch;
    const u=Math.max(0,Math.min(1,(tx*sx+ty*sy)/sq));
    const d=(tx-u*sx)**2+(ty-u*sy)**2;
    if (d<best) { best=d;at=station+u*Math.sqrt(sq); }
    station+=Math.sqrt(sq);
  }
  return [Math.sqrt(best),at];
}

let samples=0;
const worst={walker:0,car:0,cycle:0};
const counts={walker:0,car:0,cycle:0};
for (const place of routes.regions) {
  const field=mask.fields.find(({id})=>id===place.id);
  assert(field && field.scale>0 && field.width>0 && field.height>0);
  assert.equal(field.file,'world-depth/'+place.id+'.json.gz');
  const cached=JSON.parse(gunzipSync(await readFile(new URL(field.file,location))));
  assert.equal(cached.tileRevision,manifest.tileRevision);
  assert.equal(cached.id,place.id);
  const data=Buffer.from(cached.rle,'base64');
  let pixels=0,solid=0;
  assert.equal(data.length%2,0);
  for (let i=0;i<data.length;i+=2) {
    assert(data[i]>0);
    pixels+=data[i];
    if (data[i+1]>10) solid+=data[i];
  }
  assert.equal(pixels,field.width*field.height);
  assert(solid>0 && solid<pixels,place.id);
  for (const route of place.routes) {
    counts[route.kind]++;
    const line=streets.get(route.id);
    assert(line?.length>1 && route.points.length>1,route.id);
    assert(route.travel===-1 || route.travel===1);
    assert(route.oneway===0 || route.oneway===route.travel,route.id+' against recorded direction');
    const [start,end]=[route.points[0],route.points.at(-1)].map(p=>nearest(line,p)[1]);
    assert((end-start)*route.travel>=13,route.id+' endpoints contradict the mapped way direction');
    for (let i=1;i<route.points.length;i++) {
      const a=route.points[i-1],b=route.points[i],dist=pitchDistance(a,b);
      assert(dist>.01 && dist<5.2,route.id+' malformed sample interval '+dist);
      const steps=Math.ceil(dist/.60);
      for (let j=0;j<=steps;j++) {
        const u=j/steps;
        const x=a[0]+(b[0]-a[0])*u,y=a[1]+(b[1]-a[1])*u;
        assert(x>place.bounds[0] && x<place.bounds[2] && y>place.bounds[1] && y<place.bounds[3]);
        const colliders=obstruction.get(Math.floor(x/cell)+','+Math.floor(y/cell));
        const blocked=colliders?.find(({rings})=>covers(rings,x,y));
        assert(!blocked,route.id+' crosses '+blocked?.id);
        const [offset]=nearest(line,[x,y]);
        assert(offset<clearance[route.kind],route.id+' exceeds '+route.kind+' centreline clearance '+offset.toFixed(2));
        worst[route.kind]=Math.max(offset,worst[route.kind]);
        samples++;
      }
    }
  }
}
assert(Object.values(counts).every(n=>n>=10));
const source=process.env.OSTRAVA_OSM_PBF;
if (source) {
  const roads=new Map();
  for (const f of readPbf(source)) if (f.type==='way' && ways.has('w'+f.id)) roads.set('w'+f.id,f.tags);
  for (const route of allRoutes) {
    const tags=roads.get(route.id);
    assert.equal(route.highway,tags?.highway);
    const access=route.kind==='walker'?'foot':route.kind==='cycle'?'bicycle':'motor_vehicle';
    const one=tags['oneway:'+access] ?? (route.kind==='walker' ? undefined : tags.oneway);
    if (/^(yes|true|1)$/.test(one)) assert.equal(route.travel,1);
    if (one==='-1' || one==='reverse') assert.equal(route.travel,-1);
    assert(!/^(no|private|customers|permit)$/.test(tags[access]??tags.access??''));
  }
}
console.log('Verified '+JSON.stringify(counts)+' on '+routes.regions.length+' activity areas, '+samples+' unobstructed projections, source direction and revisioned depth. Peak centreline offsets '+JSON.stringify(worst)+'.');
