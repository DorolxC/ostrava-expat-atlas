import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { withinCoverage, region } from '../public/js/geo.js';
import { readPbf } from './data/osm-pbf.mjs';

const [pbfPath,heightPath] = process.argv.slice(2);
if (!pbfPath || !heightPath) throw new Error('Pass Ostrava.osm.pbf and N49E018.hgt.gz.');
const map = new URL('../public/map/',import.meta.url);
const points = [];
for (const record of readPbf(pbfPath)) {
  if (record.type!=='node' || !record.tags || !withinCoverage(...record.point)) continue;
  const t = record.tags;
  let kind;
  if (t.highway==='crossing' && (/zebra/.test(t['crossing:markings']??'') || ['marked','zebra'].includes(t.crossing))) kind='zebra';
  if (t.amenity==='fountain') kind='fountain';
  if (t.amenity==='bench') kind='bench';
  if (t.railway==='tram_stop') kind='tram-stop';
  if (kind) points.push({id:'n'+record.id,kind:'detail',tags:{kind},points:[[record.point]]});
}
writeFileSync(new URL('street-detail.json',map),JSON.stringify({
  attribution:'© OpenStreetMap contributors', license:'ODbL-1.0', points,
}));

// Skadi HGT is a degree tile, signed big-endian 16-bit heights from its NW corner.
const hgt = gunzipSync(readFileSync(heightPath));
const size = Math.sqrt(hgt.length/2);
if (![1201,3601].includes(size)) throw new Error('Unexpected HGT dimension: '+size);
const [west,south,east,north] = region.bounds;
const width = Math.ceil((east-west)*2100);
const height = Math.ceil((north-south)*2950);
const samples = [];
for (let y=0;y<height;y++) {
  for (let x=0;x<width;x++) {
    const lon = west+(east-west)*x/(width-1);
    const lat = north-(north-south)*y/(height-1);
    const gx = Math.round((lon-18)*(size-1));
    const gy = Math.round((50-lat)*(size-1));
    const altitude = hgt.readInt16BE((gy*size+gx)*2);
    samples.push(altitude<-300 ? 0 : altitude);
  }
}
writeFileSync(new URL('relief.json',map),JSON.stringify({
  bounds:region.bounds, width, height, samples,
  source:'https://registry.opendata.aws/terrain-tiles/',
  attribution:'Mapzen Terrain Tiles. Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers. Global SRTM and GMTED2010 courtesy of the U.S. Geological Survey.',
}));
console.log('Compiled '+points.length+' mapped street details and '+width+'×'+height+' elevation samples.');
