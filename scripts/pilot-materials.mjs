import { region } from '../public/js/geo.js';
import { mix, noise, shade } from './raster.mjs';

const town = [
  [0xb55c3d,0xeac696,'clay'], [0xaa4f35,0xe8d6b5,'clay'],
  [0x4c5d6e,0xe6c3a1,'slate'], [0x6b5969,0xdba594,'slate'],
  [0xcc7952,0xeadaad,'clay'], [0x7b5b58,0xe1ca9c,'clay'],
  [0x577777,0xe9d4b0,'zinc'], [0xaf6650,0xc9cea4,'clay'],
  [0xa17a6c,0xe2b8ad,'clay'], [0x526474,0xd9cec6,'slate'],
  [0x994c36,0xefce9b,'clay'], [0xad5542,0xd9b091,'clay'],
];
const modern = [
  [0x5b676c,0xcdc6b5,'felt'], [0x60777e,0xb0c5ba,'zinc'],
  [0x8e796b,0xdac4ae,'felt'], [0x536a77,0xb3c2c4,'zinc'],
  [0x72736b,0xe0cdb3,'felt'],
];
const works = [
  [0x4e595b,0xa86447,'steel'], [0x71534a,0xa76046,'steel'],
  [0x58686c,0x966951,'steel'], [0x535452,0xb38164,'steel'],
  [0x623f36,0x946149,'steel'], [0x647171,0xabb0a0,'steel'],
  [0x55646e,0xba8463,'steel'], [0x765b47,0x9d6c51,'steel'],
];

const positiveMod = (n,m)=>n-Math.floor(n/m)*m;
const material = (table,salt)=>table[Math.floor(noise(salt,66)*table.length)];

export function buildingMaterials(pilot,tags,salt,{industrial,modern:recent,small,civic,footprint}) {
  const working = industrial || pilot==='ironworks' && !small && !civic && footprint>560;
  let [roof,wall,kind]=material(working ? works : recent || small ? modern : town,salt);
  const explicit=tags['roof:material'];
  if (explicit==='metal' || explicit==='zinc' || explicit==='copper') {
    kind=explicit==='copper' ? 'copper' : working ? 'steel' : 'zinc';
    roof=mix(roof,kind==='copper' ? 0x638777 : working ? 0x59696a : 0x778b8e,0.68);
  }
  if (explicit==='roof_tiles') {
    kind='clay';
    roof=mix(roof,0xb36043,0.6);
  }
  if (explicit==='slate' || explicit==='slates') {
    kind='slate';
    roof=mix(roof,0x536275,0.72);
  }
  const brick= tags['building:material']==='brick' || working && noise(salt,16)>0.25;
  if (brick) wall=mix(wall,working ? 0xa16349 : 0xbe8867,0.56);
  return {roof,wall,kind,brick,working,salt};
}

export function groundPigment(pilot,tags) {
  if (pilot==='ironworks') {
    if (tags.landuse==='industrial') return 0x847966;
    if (tags.landuse==='railway') return 0x72695a;
    if (tags.landuse==='construction' || tags.landuse==='brownfield') return 0x927e66;
    if (tags.name==='Dolní oblast Vítkovice' && tags.area==='yes') return 0x9c8974;
    if (tags.amenity==='parking') return 0x83847a;
  }
  if (tags.leisure==='park' || tags.leisure==='garden') return 0x88a668;
  if (tags.landuse==='grass' || tags.natural==='grassland') return 0x9eb274;
  if (tags.landuse==='residential') return 0xaab47d;
  return undefined;
}

export function yardGrain(x,y,salt) {
  const gravel = noise(Math.floor(x*3.1),Math.floor(y*3.1),salt);
  const patch = noise(Math.floor(x/8),Math.floor(y/8),salt);
  return (gravel<0.13 ? -13 : gravel>0.91 ? 12 : 0)+(patch-0.5)*9;
}

export function pavingSurface(pilot,area,ox,oy,scale) {
  const tags=area.tags;
  const sett=tags.surface==='sett';
  const broad=tags.name==='Masarykovo náměstí' || tags.name==='Jiráskovo náměstí';
  const stone=pilot==='centre' ? (broad ? 0xe4d3ae : 0xd3c6a7) : 0xb0a18b;
  const diagonal= [0.835,0.55];
  const grid=sett ? [1.01,0.61] : [2.7,1.68];
  const drift=0.23*scale;
  return (x,y)=>{
    const wx=(x+ox+0.5)/scale;
    const wy=(y+oy+0.5)/(scale*region.pitch);
    const row=(-diagonal[1]*wx+diagonal[0]*wy)/grid[1];
    const col=(diagonal[0]*wx+diagonal[1]*wy)/grid[0]+(Math.floor(row)&1)*0.5;
    const shadeStone=noise(Math.floor(row),Math.floor(col),23)-0.5;
    const joint=positiveMod(row,1)<0.17 || positiveMod(col,1)<0.09;
    const course=broad && (positiveMod(row,19)<0.70 || positiveMod(col,31)<0.40);
    const strength=drift>=0.7 ? 1 : drift;
    return shade(stone,Math.round(shadeStone*8*strength+(course ? -13 : joint ? -7*strength : 1)));
  };
}

export function wallLight(base,lit,working) {
  if (working) return lit ? mix(base,0xf0c08d,0.20) : mix(base,0x32393b,0.47);
  return lit ? mix(base,0xffe5b9,0.15) : mix(base,0x49566a,0.40);
}

const slopedProfiles={
  clay: {course:0.54,tile:0.67,joint:-9,lip:11,seam:-9},
  slate: {course:0.57,tile:0.82,joint:-8,lip:6,seam:-10},
  zinc: {course:4.5,tile:1.1,joint:-16,lip:12,seam:-6},
  copper: {course:3.2,tile:1.0,joint:-13,lip:11,seam:-7},
  steel: {course:6.5,tile:1.12,joint:-18,lip:12,seam:-7},
  felt: {course:4.1,tile:2.6,joint:-9,lip:5,seam:-5},
};

export function roofSurface(kind,salt,along,across) {
  const p=slopedProfiles[kind];
  const row=across/p.course;
  const col=along/p.tile+((kind==='clay'||kind==='slate')&&(Math.floor(row)&1) ? 0.5 : 0);
  const u=positiveMod(col,1);
  const v=positiveMod(row,1);
  const tint=(noise(Math.floor(col),Math.floor(row),salt)-0.5)*9;
  const dye=(noise(Math.floor(along/8),Math.floor(across/6),salt)-0.5)*9;
  const raised=u>0.72 && kind!=='clay' && kind!=='slate';
  return Math.round(tint+dye+(v<0.17 ? p.seam : u<0.145 ? p.joint : raised || v>0.78 ? p.lip : 0));
}

export function flatSurface(kind,salt,along,across) {
  if (kind==='steel' || kind==='zinc' || kind==='copper') {
    const groove=positiveMod(across,kind==='steel' ? 1.32 : 1.14);
    const course=positiveMod(along,6.4)<0.21;
    const pan=noise(Math.floor(across/1.32),Math.floor(along/6.4),salt);
    return Math.round((pan-0.5)*9+(groove<0.20 ? -18 : groove<0.38 ? 11 : course ? -10 : 0));
  }
  return roofSurface(kind,salt,along,across);
}
