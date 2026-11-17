import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { places, categories, verification } from '../public/js/places.js';
import { searchPlaces } from '../public/js/search.js';
import { project, toGeographic, region, withinCoverage } from '../public/js/geo.js';
import { loadBlenderModels } from './blender-models.mjs';

const assets = new URL('../public/map/',import.meta.url);
const load = (name) => readFile(new URL(name,assets),'utf8').then(JSON.parse);
const [manifest,geometry,boundary,districts,anchors,motion,canopies,flow,street,relief] = await Promise.all([
  load('scene.json'),load('geometry.json'),load('boundary.json'),load('districts.json'),load('landmarks.json'),
  load('motion.json'),load('canopies.json'),load('river-flow.json'),load('street-detail.json'),load('relief.json'),
]);
assert.deepEqual(geometry.bounds,region.bounds);
assert.equal(geometry.license,'ODbL-1.0');
assert.deepEqual(manifest.bounds,geometry.bounds);
assert.equal(manifest.features,geometry.features.length);
assert(geometry.features.filter(({kind}) => kind==='building').length > 100000);
assert(geometry.features.some(({kind,tags}) => kind==='waterline' && tags.name==='Ostravice'));
assert.equal(boundary.geometry.type,'MultiPolygon');
assert.equal(districts.districts.length,23);
assert.equal(new Set(districts.districts.map(({id})=>id)).size,23);
assert.equal(districts.license,'CC BY 4.0');
assert(anchors.structures.every((model) => withinCoverage(...model.point)));
for (const landmark of ['r6827528','w462065478','w462065480','w47987365','w38935068','w78540797']) {
  assert(geometry.features.some(({id})=>id===landmark),'Missing mapped landmark '+landmark);
}
assert.equal(new Set(places.map((place)=>place.id)).size,places.length);

for (const { center } of districts.districts) {
  assert(withinCoverage(...center));
  const [x,y] = project(...center);
  const ax = x*manifest.scale-manifest.ox;
  const ay = y*manifest.scale-manifest.oy;
  assert(manifest.tiles.some(({x,y,w,h}) => ax>=x && ax<x+w && ay>=y && ay<y+h));
}
for (const place of places) {
  assert.match(place.osm,/^(node|way|relation)\/\d+$/);
  assert(place.description && place.address && new URL(place.website).protocol==='https:');
  assert(place.categories.every((id)=>categories.some((category)=>category.id===id)));
  assert(withinCoverage(...place.coordinates));
  const [x,y] = project(...place.coordinates);
  const [lon,lat] = toGeographic(x,y);
  assert(Math.abs(lon-place.coordinates[0])<1e-8 && Math.abs(lat-place.coordinates[1])<1e-8);
  assert(verification[place.english.kind]);
  if (place.english.kind!=='unverified') {
    assert(place.english.note && place.english.checked && new URL(place.english.source).protocol==='https:');
  }
  if (place.image) assert((await stat(new URL('../public/'+place.image,import.meta.url))).size>0);
}

const levels = [manifest,...manifest.closeups];
assert.equal(levels.length,5);
assert.equal(manifest.scale,2.78);
assert(levels.slice(1).every(({scale,minZoom})=>scale===4.25 && minZoom>3));
const blender=await loadBlenderModels();
const mappedBuildings=new Set(geometry.features.filter(({kind})=>kind==='building' || kind==='part').map(({id})=>id));
assert.deepEqual(blender.map(({id})=>id).sort(),['arena','dum-kultury','hrad','karolina','organica','trojhali']);
for (const model of blender) {
  assert(withinCoverage(...model.point),model.id+' is outside the atlas');
  assert(model.sources.some(source=>new URL(source).protocol==='https:'),model.id+' is missing source evidence');
  assert(model.geometry.buildings.length && model.geometry.buildings.every(id=>mappedBuildings.has(id)),model.id+' replaces an unknown building');
  assert(model.mesh.length && model.mesh.every(v=>v.length===3 && v.every(Number.isFinite)),model.id+' contains invalid mesh vertices');
  assert(model.faces.length && model.faces.every(([a,b,c,rgb])=>new Set([a,b,c]).size===3 &&
    [a,b,c].every(index=>Number.isInteger(index) && index>=0 && index<model.mesh.length) &&
    Number.isInteger(rgb) && rgb>=0 && rgb<=0xffffff),model.id+' contains invalid mesh faces');
}
assert(motion.tracks.length>=3 && motion.step>0);
assert(motion.fountains.length>0 && motion.fountains.every(point=>point.length===2 && point.every(Number.isFinite)));
for (const {points,controls} of motion.tracks) {
  assert(controls.every(([distance,kind],i)=>Number.isInteger(distance) && distance>=0 && distance<(points.length-1)*motion.step &&
    (kind===0 || kind===1) && (i===0 || controls[i-1][0]<distance)));
}
assert.equal(flow.version,2);
assert(flow.samples.length>2000);
for (const [x,y,dx,dy,bend,range,station,phase] of flow.samples) {
  assert(Number.isFinite(x) && Number.isFinite(y) && Math.abs(bend)<=1 && range>0);
  assert(Math.abs(Math.hypot(dx,dy/region.pitch)-1)<.003);
  assert(Number.isFinite(station) && Number.isFinite(phase));
}
assert(canopies.length>1000);
const crownRounding=manifest.scale*.050001;
for (const [x,y,radius,seed,conifer] of canopies) {
  const px=x*manifest.scale-manifest.ox;
  const py=y*manifest.scale-manifest.oy;
  assert(px>=-crownRounding && px<manifest.width+crownRounding && py>=-crownRounding && py<manifest.height+crownRounding);
  assert(radius>0 && seed>=0 && seed<256 && (conifer===0 || conifer===1));
}
assert(street.points.some(({tags})=>tags.kind==='zebra') && street.points.some(({tags})=>tags.kind==='tram-stop'));
assert.deepEqual(relief.bounds,region.bounds);
assert.equal(relief.samples.length,relief.width*relief.height);

function tileDimensions(bytes,name) {
  if (name.endsWith('.png')) {
    assert.equal(bytes.toString('ascii',12,16),'IHDR');
    return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  }
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  const code = bytes.toString('ascii',12,16);
  if (code==='VP8X') return [bytes.readUIntLE(24,3)+1,bytes.readUIntLE(27,3)+1];
  assert.equal(code,'VP8L');
  assert.equal(bytes[20],0x2f);
  const info = bytes.readUInt32LE(21);
  return [(info&0x3fff)+1,((info>>>14)&0x3fff)+1];
}

const names = new Set();
for (const level of levels) {
  assert(level.tiles.length>0);
  for (const tile of level.tiles) {
    assert(tile.x>=0 && tile.y>=0 && tile.x+tile.w<=level.width && tile.y+tile.h<=level.height);
    assert(!names.has(tile.name));
    names.add(tile.name);
    const [width,height] = tileDimensions(await readFile(new URL(tile.name,assets)),tile.name);
    assert.equal(width,tile.w);
    assert.equal(height,tile.h);
  }
}
assert.equal(searchPlaces(places,{query:'dolni vitkvoice'})[0].id,'bolt-tower');
assert.equal(searchPlaces(places,{query:'cokafe'})[0].id,'cokafe-centrum');
assert.equal(searchPlaces(places,{category:'food',english:'confirmed'}).length,0);
assert.deepEqual(searchPlaces(places,{category:'culture',tags:['Student friendly']}).map((p)=>p.id),['science-centre']);
console.log('Verified 23 districts, mapped details, motion data, place search and '+names.size+' tiles.');
