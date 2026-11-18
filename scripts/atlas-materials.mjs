import { region } from '../public/js/geo.js';
import { mix, noise, shade } from './raster.mjs';

export const mapStyles = {
  atlas: {
    ground: 0xa8b681, openWater: 0x508694, bank: 0x738359, bankRim: 0xb8b481, shallows: 0x81a79d,
    shadow: 0x384252, foliageShadow: 0x34523b, sunlight: 0xffe2a5, plasterShade: 0x71605b,
    grass: 0xa6b779, park: 0x94ae6c, wood: 0x5c8252, scrub: 0x8ca46b, field: 0xc3a766,
    wet: 0x7d9c7b, green: 0x8eab68, housing: 0xb6bb89, sand: 0xc6b599,
    works: 0x89816d, ballast: 0x756f61, groundBrick: 0xa28b72, paving: 0xd7ccb2, plaza: 0xe5d6b4,
    leaves: [0x4b7849,0x547e50,0x638748,0x698d4b,0x79924a,0x527045,0x617f54],
    conifers: [0x3c674e,0x476e50,0x416954,0x52764f,0x4e714b],
    summerLeaf: 0xc2bf77,
  },
  foundry: {
    ground: 0x8c9a7d, openWater: 0x477d8b, bank: 0x5b6c52, bankRim: 0x9a9e78, shallows: 0x749b92,
    shadow: 0x273045, foliageShadow: 0x293f39, sunlight: 0xecc5a0, plasterShade: 0x344157,
    grass: 0x8e9e74, park: 0x7a956e, wood: 0x4c6b53, scrub: 0x758b68, field: 0xa99666,
    wet: 0x688674, green: 0x748e67, housing: 0x9da580, sand: 0xa7a399,
    works: 0x68665d, ballast: 0x625e59, groundBrick: 0x7e7366, paving: 0xb3afa7, plaza: 0xc5b7a1,
    leaves: [0x456d4c,0x50744c,0x597f53,0x64814e,0x6f8851,0x4a6b4a,0x556d53],
    conifers: [0x3c6250,0x45664e,0x3c6255,0x4b6d51,0x4e6e4c],
    summerLeaf: 0xaeac75,
  },
};

// Both proofs share the atlas geometry and the existing water pigments. Their
// surface treatment differs at the raster sample level as well as in color.
mapStyles.daylight = {
  ...mapStyles.atlas,
  technique:'daylight', ground:0xb0b38d, urbanGround:0xbeb6a1,
  grass:0xa4b475, park:0x97af71, wood:0x72915c, scrub:0x96a667,
  green:0x8bab63, housing:0xb8b98d, field:0xc0a66f, sand:0xc6b89b, paving:0xdcd1b8, plaza:0xe7d8b9,
  works:0x969080, ballast:0x81796c, groundBrick:0xac957b,
  asphalt:0x90928b, concrete:0xb5b2a4, gravel:0xb0a391, earth:0xbba583,
  shadow:0x494452, sunlight:0xffe6ae, plasterShade:0x71635b,
  litGlass:0x71918f, shadeGlass:0x586f77, window:0x40434a,
};
mapStyles.lithograph = {
  ...mapStyles.atlas,
  technique:'lithograph', ground:0xb0b18c, grass:0xa3b08b, park:0x95a483, wood:0x6c8b73, scrub:0x909e82,
  green:0x8fa88d, housing:0xb6b392, field:0xb7a379, sand:0xc3b7a1, paving:0xd4c6aa, plaza:0xdfd0b1,
  works:0x777675, ballast:0x77736b, groundBrick:0xa28d7d,
  shadow:0x443d54, sunlight:0xe6cfa7, plasterShade:0x6f6777,
  litGlass:0x7c9294, shadeGlass:0x617586, window:0x423e53,
};
mapStyles.afternoon = {
  ...mapStyles.daylight,
  ground:0xb7b890, urbanGround:0xc3b7a2, housing:0xbdbb90,
  grass:0xa7ba7f, park:0x99b375, wood:0x76945f, field:0xc8ad76,
  works:0x9d9082, earth:0xc1a786, paving:0xe1d1b4, plaza:0xf0dbb6,
  shadow:0x494962, foliageShadow:0x3d5348, sunlight:0xffdb98, plasterShade:0x726371,
  litGlass:0x769793, shadeGlass:0x5b7286, window:0x414c56, summerLeaf:0xd0bf76,
  light:{cast:1.30,softness:1.18,strength:141,falloff:83,wallSun:.26,wallShade:.38,roofSun:.0068,weathered:true},
};
mapStyles.overcast = {
  ...mapStyles.daylight,
  ground:0xa8b292, urbanGround:0xb7b6ac, housing:0xaeb79c,
  grass:0x99ac80, park:0x8ca77e, wood:0x67886d, field:0xb7a885,
  works:0x8d9189, earth:0xada18d, paving:0xd5d1c3, plaza:0xe2d7c6,
  shadow:0x435669, foliageShadow:0x3d5752, sunlight:0xe6e9de, plasterShade:0x647786,
  litGlass:0x819c9e, shadeGlass:0x697f8c, window:0x445764, summerLeaf:0xb9c28a,
  light:{cast:.88,softness:1.75,strength:102,falloff:60,wallSun:.23,wallShade:.26,roofSun:.0048},
};

// These pigments share the afternoon geometry, canopy and water colors.
mapStyles['postcard-ochre'] = {
  ...mapStyles.afternoon, postcard:'ochre', urbanGround:0xcaba9c,
  paving:0xd1bb9f, plaza:0xede1c8, concrete:0xc3b4a4,
  shadow:0x49405a, sunlight:0xffe5b0, plasterShade:0x71586e,
  litGlass:0x5c8580, shadeGlass:0x425d72, window:0x363e4a,
  light:{...mapStyles.afternoon.light,wallSun:.34,wallShade:.49,roofSun:.0093,strength:158,falloff:94},
};
mapStyles['postcard-slate'] = {
  ...mapStyles.afternoon, postcard:'slate', urbanGround:0xaeadab,
  paving:0xa3aeb2, plaza:0xcbd6d5, concrete:0xb5bdc2,
  shadow:0x38495f, sunlight:0xf9ecd0, plasterShade:0x536a80,
  litGlass:0x60838c, shadeGlass:0x3c5668, window:0x323a51,
  light:{...mapStyles.afternoon.light,wallSun:.27,wallShade:.54,roofSun:.0064,strength:166,falloff:99},
};

// Roof and façade pairs by architectural family. Deterministic seed selection
// gives neighboring houses variety while keeping the district character intact.
const palettes = {
  town: [
    [0xb35538,0xeac89a,'clay'],[0xa9503e,0xece0bc,'clay'],[0xc87950,0xe7c397,'clay'],
    [0x4d6070,0xe6c6ac,'slate'],[0x735c62,0xe0a892,'slate'],[0x9a6b57,0xc6ccad,'clay'],
    [0x638a7e,0xe9d5ad,'copper'],[0xbd644b,0xdcc1a7,'clay'],[0x63717a,0xd7cec2,'slate'],
    [0x95533c,0xe6d2ad,'clay'],[0x785961,0xe2bec1,'slate'],[0xc56542,0xbfc6a1,'clay'],
  ],
  poruba: [
    [0xb46543,0xe8cea0,'clay'],[0x99553c,0xe6b28a,'clay'],[0x965f4d,0xe7c8b8,'clay'],
    [0x625d55,0xe3d5ac,'slate'],[0xaf6749,0xdbb496,'clay'],[0x8e584b,0xd0c7a9,'clay'],
  ],
  houses: [
    [0xb36143,0xe0d1ae,'clay'],[0x9e4a38,0xd9b18e,'clay'],[0xbd7251,0xe9cc9c,'clay'],
    [0x586a71,0xe0d4bd,'slate'],[0x786364,0xd7bdac,'slate'],[0xb57455,0xd0c2a3,'clay'],
    [0x6a776e,0xd4d1ad,'zinc'],[0xa45041,0xdac3b2,'clay'],
  ],
  estate: [
    [0x75807f,0xc8c5ae,'felt'],[0x697882,0xc3c9c2,'felt'],[0x7f786b,0xd1bda6,'felt'],
    [0x7b8486,0xd6c7ad,'felt'],[0x626d70,0xc8cdd1,'felt'],[0x85847e,0xe0c9b1,'felt'],
  ],
  modern: [
    [0x69777c,0xc0c9bd,'zinc'],[0x586a79,0xb1c5cb,'steel'],[0x82786d,0xdac7ac,'felt'],
    [0x697876,0xd3d1c2,'felt'],[0x607680,0xb6c2bc,'zinc'],[0x777566,0xcebbad,'felt'],
  ],
  industry: [
    [0x49595e,0xb38564,'steel'],[0x667373,0xa66b4c,'steel'],[0x6c5547,0xb38265,'steel'],
    [0x535853,0x9d7967,'steel'],[0x647278,0xafaaa0,'steel'],[0x684f46,0xa76348,'steel'],
  ],
  ironworks: [
    [0x414c53,0xa96145,'steel'],[0x536065,0x9f654e,'steel'],[0x684539,0xb16d4f,'steel'],
    [0x5d5953,0x967255,'steel'],[0x465653,0xa39c87,'steel'],[0x78513d,0xb47b60,'steel'],
  ],
};

const miniaturePalettes = {
  town: [
    [0xab613f,0xe7c391,'clay'],[0xa5533d,0xece0be,'clay'],[0xbb7047,0xe0b184,'clay'],
    [0x635d70,0xe6c1a9,'slate'],[0x9a564c,0xd8ab96,'clay'],[0x546870,0xd7cbb1,'slate'],
    [0x577d70,0xe4d0a4,'copper'],[0xb67356,0xc2c7a9,'clay'],
  ],
  secession: [
    [0x667989,0xe3cc9d,'slate'],[0xa46b51,0xd9d8af,'clay'],[0x635d72,0xe4c3b6,'slate'],
    [0x67867b,0xe5d8b0,'copper'],[0xb66f52,0xe8bf9c,'clay'],[0x85645e,0xdfb0a1,'slate'],
  ],
  plaster: [
    [0x8f665d,0xc6c7a8,'clay'],[0x686c70,0xe2ceb0,'slate'],[0xa5624e,0xd1ac9c,'clay'],
    [0x6b7474,0xd2c5b3,'zinc'],[0xa6745a,0xd9ba95,'clay'],
  ],
  functional: [
    [0x777e7d,0xe4d9bd,'felt'],[0x7d7b73,0xd8cab0,'felt'],[0x67777d,0xd7d6cd,'zinc'],
    [0x8c8580,0xe0c8bd,'felt'],
  ],
  poruba: [
    [0xa96040,0xe1bf89,'clay'],[0xa36048,0xdfc6a2,'clay'],[0xb06b48,0xeacda4,'clay'],
    [0x955642,0xd6ae89,'clay'],[0xad6249,0xdab5a4,'clay'],[0x86614c,0xd5bc96,'clay'],
  ],
  estate: [
    [0x777a78,0xcdc6ad,'felt'],[0x727f83,0xc6cebe,'felt'],[0x82796d,0xd5bdad,'felt'],
    [0x7e808c,0xd8cfbe,'felt'],[0x697276,0xbfc8c7,'felt'],
  ],
  houses: [
    [0xad5c44,0xe7d3ac,'clay'],[0xa25141,0xddb48f,'clay'],[0xbd7752,0xe5c699,'clay'],
    [0x666878,0xe2d7c2,'slate'],[0x786069,0xd9c1af,'slate'],[0xb56e4a,0xcbc5a8,'clay'],
    [0x727c72,0xd6d3b4,'zinc'],[0xb2644e,0xe2bea9,'clay'],[0x96604d,0xd8cfc3,'clay'],
  ],
  row: [
    [0xaf6947,0xe7c097,'clay'],[0xa65c48,0xe4ccaa,'clay'],[0x9f604b,0xd4bd97,'clay'],
    [0xa86b4e,0xddd1ad,'clay'],[0x756571,0xe8c9b0,'slate'],
  ],
  modernHouse: [
    [0x74787e,0xe3dcca,'felt'],[0x77776e,0xc8b99f,'felt'],[0x686b65,0xd5d6c5,'felt'],
  ],
  modern: [
    [0x667278,0xc5d0c7,'zinc'],[0x697d83,0xb7c6c8,'steel'],[0x857d71,0xd5c2aa,'felt'],
    [0x7e8b90,0xb8c9cf,'zinc'],[0x76796d,0xcecab6,'felt'],
  ],
  school: [
    [0x727974,0xdfceb0,'felt'],[0xaa6147,0xe2c29b,'clay'],[0xad7758,0xd5c7a1,'clay'],[0x6d7d81,0xc4d0c1,'zinc'],
  ],
  civic: [
    [0x596d77,0xe5cca2,'slate'],[0x678b83,0xe4d6b6,'copper'],[0x98624c,0xe0b993,'clay'],
  ],
  ironworks: [
    [0x555e60,0xa16951,'steel'],[0x666a65,0xad6d4e,'steel'],[0x685247,0xb57655,'steel'],
    [0x686157,0xa4775b,'steel'],[0x4d6162,0x8d7969,'steel'],
  ],
  workshop: [
    [0x656e70,0xa67960,'steel'],[0x7b6b5c,0xb58e6d,'steel'],[0x657679,0xa5aaa0,'steel'],
    [0x7a594a,0xae7758,'steel'],[0x6f6d64,0xbb9b7c,'steel'],
  ],
  industry: [
    [0x697471,0xaab1a4,'steel'],[0x777c78,0xc0b59d,'steel'],[0x676d73,0x9fa5a3,'steel'],
    [0x7c7569,0xb6a999,'steel'],
  ],
  ancillary: [
    [0x858279,0xbbad94,'felt'],[0x656d67,0xb1b49e,'felt'],[0x9a7059,0xd0b49b,'clay'],
    [0x797e7b,0xafb4aa,'zinc'],
  ],
};

const mod=(n,m)=>n-Math.floor(n/m)*m;
const pick=(palette,salt,n)=>palette[Math.floor(noise(salt,n)*palette.length)];

function landMottle(x,y,salt) {
  const ix=Math.floor(x);
  const iy=Math.floor(y);
  const fx=x-ix;
  const fy=y-iy;
  const wx=fx*fx*(3-2*fx);
  const wy=fy*fy*(3-2*fy);
  const a=noise(ix,iy,salt);
  const b=noise(ix,iy+1,salt);
  const low=a+(noise(ix+1,iy,salt)-a)*wx;
  const high=b+(noise(ix+1,iy+1,salt)-b)*wx;
  return low+(high-low)*wy;
}

export function groundDensity(buildings,ox,oy,width,height,scale) {
  const step = 63;
  const originX = Math.floor(ox/scale/step);
  const originY = Math.floor(oy/(scale*region.pitch)/step);
  const columns = Math.ceil((ox+width)/scale/step)-originX+2;
  const rows = Math.ceil((oy+height)/(scale*region.pitch)/step)-originY+2;
  const grid = new Float32Array(columns*rows);
  const add = (x,y,amount) => {
    if (x>=0 && y>=0 && x<columns && y<rows) grid[y*columns+x] += amount;
  };
  for (const f of buildings) {
    const outline = f.worldRings[0];
    if (outline.length<4 || f.tags.location==='underground') continue;
    let doubleArea = 0;
    let centroidX = 0;
    let centroidY = 0;
    const [baseX,baseY] = outline[0];
    for (let i=1;i<outline.length-1;i++) {
      const ax = outline[i][0]-baseX;
      const ay = outline[i][1]-baseY;
      const bx = outline[i+1][0]-baseX;
      const by = outline[i+1][1]-baseY;
      const cross = ax*by-ay*bx;
      doubleArea += cross;
      centroidX += (ax+bx)*cross;
      centroidY += (ay+by)*cross;
    }
    if (Math.abs(doubleArea)<16) continue;
    const worldX = (baseX+centroidX/(3*doubleArea))/step-originX;
    const worldY = (baseY+centroidY/(3*doubleArea))/(step*region.pitch)-originY;
    const x = Math.floor(worldX);
    const y = Math.floor(worldY);
    const dx = worldX-x;
    const dy = worldY-y;
    const weight = Math.min(15,Math.abs(doubleArea)/(2*region.pitch*115));
    add(x,y,weight*(1-dx)*(1-dy));
    add(x+1,y,weight*dx*(1-dy));
    add(x,y+1,weight*(1-dx)*dy);
    add(x+1,y+1,weight*dx*dy);
  }

  const prepare = (size,offset,denominator,origin) => {
    const at = new Int32Array(size);
    const weight = new Float32Array(size);
    for (let i=0;i<size;i++) {
      const position = (i+offset)/denominator-origin;
      at[i] = Math.floor(position);
      weight[i] = position-at[i];
    }
    return [at,weight];
  };
  const [column,dx] = prepare(width,ox,step*scale,originX);
  const [row,dy] = prepare(height,oy,step*scale*region.pitch,originY);
  return (x,y) => {
    const offset = row[y]*columns+column[x];
    const west = grid[offset]+(grid[offset+columns]-grid[offset])*dy[y];
    const east = grid[offset+1]+(grid[offset+columns+1]-grid[offset+1])*dy[y];
    const density = west+(east-west)*dx[x];
    return Math.min(20,Math.max(0,Math.round((density-1)*1.95)));
  };
}

export function atlasBuilding(style,family,tags,salt,{small,civic,architecture,pitched}) {
  const industrial=family==='industry'||family==='ironworks'||family==='workshop';
  const legacy=['town','secession','plaster','poruba','row','school','civic'].includes(family)||civic;
  let [roof,wall,kind]=pick(architecture ? miniaturePalettes[family] : palettes[small ? 'houses' : family],salt,66);
  if (civic && !architecture) [roof,wall,kind]=[0x687478,0xe2cdaa,'slate'];
  // A flat surface uses the same family of pigment with full-width sheets.
  if (architecture && !pitched && ['clay','slate'].includes(kind)) {
    kind='felt';
    roof=mix(roof,0x727674,.47);
  }
  const explicit=tags['roof:material'];
  switch(explicit) {
    case 'metal': case 'tin': case 'zinc': case 'copper':
      kind=explicit==='copper' ? 'copper' : industrial ? 'steel' : 'zinc';
      roof=mix(roof,kind==='copper' ? 0x648c7f : industrial ? 0x55696c : 0x788b8f,.72);
      break;
    case 'roof_tiles': case 'tile':
      kind='clay';
      roof=mix(roof,0xae5e40,.56);
      break;
    case 'slate': case 'slates':
      kind='slate';
      roof=mix(roof,0x546577,.72);
      break;
    case 'concrete': case 'bitumen':
      kind='felt';
      roof=mix(roof,0x737674,.54);
      break;
  }
  const brick=architecture ? architecture.brick :
    tags['building:material']==='brick'||industrial&&noise(salt,16)>.27;
  if (brick) wall=mix(wall,industrial ? 0xa5684b : 0xb98168,.60);
  if (style==='lithograph') {
    const print=kind==='clay' ? 0x906057 : kind==='copper' ? 0x557871 : 0x575c72;
    roof=mix(roof,print,.42);
    wall=mix(wall,industrial ? 0x9b725f : 0xd9c6a0,.29);
  } else if (style==='foundry') {
    const surface=kind==='clay' ? 0x744d43 : kind==='copper' ? 0x385d58 : 0x364455;
    roof=mix(roof,surface,.55);
    wall=mix(wall,industrial ? 0x925b4b : 0x8595a5,.38);
  } else if (!industrial && (legacy || family==='houses')) {
    wall=mix(wall,0xf5d5a8,.15);
  }
  if (style==='afternoon' || mapStyles[style]?.postcard) {
    if (kind==='clay') roof=mix(roof,industrial?0x944d3b:0xaf5638,.20);
    if (industrial && kind==='steel') roof=mix(roof,0x556975,.24);
    if (family==='poruba') wall=mix(wall,0xf0cc9b,.22);
    if (family==='secession' || family==='town') wall=mix(wall,0xf3d0a6,.12);
    if (family==='estate' || family==='modern') wall=mix(wall,0xc9d0c8,.18);
  }
  const postcard=mapStyles[style]?.postcard;
  if (postcard && !industrial) {
    const ochre=postcard==='ochre';
    if (kind==='clay') roof=mix(roof,ochre?0xa6462a:0x755261,.35);
    else if (kind==='copper') roof=mix(roof,ochre?0x46796d:0x466a7b,.36);
    else roof=mix(roof,ochre?0x526477:0x4f687f,.30);
    if (family==='town' || family==='secession') {
      const historic=ochre?[0xf4d8a1,0xe2af92,0xbfc0a0,0xf2d8bc]:[0xded5c3,0xaeb8c3,0xc2cac4];
      wall=mix(wall,pick(historic,salt,178),.42);
    }
  }
  const trim=brick ? 0xcfab89 : architecture ? (legacy ? 0xf5dfb7 : 0xd9d6c2) :
    legacy ? 0xf2dbaf : 0xd5d1b7;
  return {roof,wall,kind,brick,salt,working:industrial,legacy,trim};
}

const setts = new Set(['sett','paving_stones','cobblestone','unhewn_cobblestone','brick','stone']);
const earths = new Set(['dirt','earth','ground','mud','unpaved','clay']);
const gravel = new Set(['gravel','fine_gravel','compacted','pebblestone','shingle','rock','bare_rock','scree']);
const lawn = new Set(['grass','meadow','recreation_ground','village_green','greenery']);
const civic = new Set(['education','institutional','religious','commercial','retail','civic_admin']);

function taggedSurface(palette, surface) {
  if (surface === 'asphalt') return [palette.asphalt,'aggregate'];
  if (surface?.startsWith('concrete')) return [palette.concrete,'concrete'];
  if (setts.has(surface)) return [palette.paving,'setts'];
  if (surface === 'paved') return [palette.paving,'aggregate'];
  if (surface === 'grass') return [palette.grass,'grass'];
  if (surface === 'grass_paver') return [mix(palette.grass,palette.concrete,.65),'aggregate'];
  if (gravel.has(surface)) return [palette.gravel,'gravel'];
  if (earths.has(surface)) return [palette.earth,'soil'];
  if (surface === 'sand') return [palette.sand,'soil'];
  return null;
}

// [pigment, texture, paint order, optional planting spacing in metres].
// Broad land use supplies an underpainting; a surveyed surface takes priority.
export function daylightTerrain(palette,t) {
  const specified = taggedSurface(palette,t.surface);
  if (t.leisure === 'pitch' && (!specified || t.surface === 'grass')) return [palette.green,'pitch',7];
  if (specified) return [...specified,7];
  if (t.natural === 'wood' || t.landuse === 'forest' || t.landcover === 'trees') return [palette.wood,'wood',5,15];
  if (t.natural === 'scrub' || t.landcover === 'scrub') return [palette.scrub,'heath',5,26];
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'nature_reserve') return [palette.park,'park',3,t.leisure === 'nature_reserve' ? 23 : 20];
  if (t.natural === 'wetland' || t.natural === 'reedbed') return [palette.wet,'wet',5];
  if (lawn.has(t.landuse) || t.natural === 'grassland' || t.landcover === 'grass') return [palette.grass,'grass',5, t.landuse === 'recreation_ground' ? 40 : 0];
  if (t.landuse === 'orchard' || t.landuse === 'vineyard') return [palette.scrub,'orchard',4,t.landuse === 'orchard' ? 14 : 0];
  if (t.landuse === 'allotments' || t.landuse === 'plant_nursery') return [palette.housing,'allotment',4,35];
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return [palette.park,'park',4,32];
  if (t.landuse === 'farmland') return [palette.field,'field',4];
  if (gravel.has(t.natural) || t.landuse === 'quarry') return [palette.gravel,'gravel',5];
  if (t.natural === 'sand' || t.natural === 'beach') return [palette.sand,'soil',6];
  if (t.landuse === 'residential') return [palette.housing,'housing',1,46];
  if (t.landuse === 'industrial' || t.name === 'Dolní oblast Vítkovice' && t.area === 'yes') return [palette.works,'yard',2];
  if (t.landuse === 'railway') return [palette.ballast,'gravel',2];
  if (t.landuse === 'construction' || t.landuse === 'brownfield') return [palette.groundBrick,'soil',2];
  if (civic.has(t.landuse) || ['school','college','university','hospital'].includes(t.amenity)) return [palette.urbanGround,'soil',2];
  if (t.leisure === 'track' && t.sport === 'athletics') return [0xb18e77,'aggregate',7];
  if (t.landuse === 'garages' || t.amenity === 'parking' || t.leisure === 'track') return [palette.asphalt,'aggregate',7];
  if (t.highway === 'platform' || t.railway === 'platform' || t.public_transport === 'platform') return [palette.concrete,'concrete',7];
  if (t.highway === 'pedestrian' || t.place === 'square') return [palette.paving,'setts',8];
  return null;
}

export function terrainMaterial(palette,t) {
  if (t.natural==='wood'||t.landuse==='forest') return [palette.wood,'wood'];
  if (t.leisure==='park'||t.leisure==='garden'||t.leisure==='nature_reserve') return [palette.park,'park'];
  if (t.natural==='scrub'||t.landuse==='orchard') return [palette.scrub,'park'];
  if (t.natural==='wetland') return [palette.wet,'wet'];
  if (t.landuse==='farmland') return [palette.field,'field'];
  if (t.landuse==='residential') return [palette.housing,'grass'];
  if (['grass','meadow','recreation_ground','village_green','allotments','cemetery'].includes(t.landuse)||t.natural==='grassland') return [palette.grass,'grass'];
  if (t.leisure==='pitch') return [palette.green,'pitch'];
  if (t.landuse==='industrial'||t.name==='Dolní oblast Vítkovice'&&t.area==='yes') return [palette.works,'yard'];
  if (t.landuse==='railway') return [palette.ballast,'yard'];
  if (t.landuse==='construction'||t.landuse==='brownfield') return [palette.groundBrick,'yard'];
  if (t.amenity==='parking'||t.leisure==='track') return [palette.ballast,'yard'];
  if (['commercial','retail','education'].includes(t.landuse)) return [palette.sand,'park'];
  if (t.highway==='pedestrian'||t.area==='yes') return [palette.paving,'paving'];
  return null;
}

export function landscapeGrain(kind,x,y,salt,axisX,axisY,style,scale) {
  if (style?.technique==='lithograph' && kind!=='field' && kind!=='pitch') {
    const mark=mod(x+y*.71,2.97)<.43 && mod(x-y*.27,5.4)<2.9;
    const broad=noise(Math.floor(x/16),Math.floor(y/12),salt);
    return (broad<.34 ? -4 : broad>.73 ? 4 : 0)+(scale>=1.1 && mark ? -9 : 0);
  }
  if (style?.technique==='daylight' && kind!=='field' && kind!=='pitch') {
    const grit = scale>=1.45 ? noise(Math.floor(x*1.6),Math.floor(y*1.6),salt+17) : .5;
    const tint = landMottle((x+y*.27)/13,(y-x*.37)/17,salt)-.5;
    const base = Math.round(tint*5)*2;
    if (kind==='housing' || kind==='soil') return base+(grit>.97 ? 7 : grit<.026 ? -8 : 0);
    if (kind==='yard' || kind==='gravel') {
      const rubble = noise(Math.floor(x/5.1),Math.floor(y/3.7),salt+28);
      return base+(rubble-.5)*5+(grit>.93 ? 9 : grit<.085 ? -9 : 0);
    }
    if (kind==='aggregate') return base*.52+(grit>.95 ? 8 : grit<.052 ? -8 : 0);
    const across = x*axisX+y*axisY;
    const along = -x*axisY+y*axisX;
    if (kind==='concrete') {
      const seam=scale>=1.5 && (mod(across,5.4)<.37 || mod(along,9.2)<.31);
      return base*.65+(seam ? -10 : grit>.97 ? 5 : 0);
    }
    if (kind==='setts') {
      const row=Math.floor(across/.9);
      const shifted=along+(row&1)*.68;
      const seam=scale>=2.2 && (mod(across,.9)<.18 || mod(shifted,1.36)<.16);
      return base*.45+(noise(Math.floor(shifted/1.36),row,salt)-.5)*6+(seam ? -9 : 0);
    }
    if (kind==='orchard' || kind==='allotment') {
      const plot = noise(Math.floor(across/7.5),Math.floor(along/14),salt);
      return base+(plot-.5)*12+(mod(across,7.5)<.58 ? kind==='orchard' ? 6 : 13 : 0);
    }
    const blade = grit>.975 ? 7 : grit<.034 ? -5 : 0;
    return base+(kind==='wood' ? base*.65 : kind==='heath' ? base*1.2 : 0)+blade;
  }
  const block=noise(Math.floor(x/5.5),Math.floor(y/4.9),salt);
  const grit=noise(Math.floor(x*2.1),Math.floor(y*2.4),salt);
  if (kind==='field') {
    const across=x*axisX+y*axisY;
    const row=mod(across,2.8);
    const pass=Math.floor(across/14);
    return (row<0.52 ? -13 : row<0.93 ? -7 : row>2.23 ? 5 : 0)+(noise(pass,93,salt)-.5)*8+(grit>.94 ? 7 : 0);
  }
  if (kind==='yard') return (block-.5)*9+(grit<.095 ? -17 : grit>.91 ? 13 : 0);
  if (kind==='wet') return (block-.5)*13+(grit<.10 ? -8 : grit>.9 ? 8 : 0);
  if (kind==='paving') return (block-.5)*5+(grit<.06 ? -10 : grit>.95 ? 5 : 0);
  if (kind==='pitch') return Math.floor((x-y*.76)/8.4)%2===0 ? 9 : -4;
  return (block-.5)*(kind==='wood'?15:9)+(grit<.08 ? -9 : grit>.96 ? 10 : 0);
}

export function pavingSurface(palette,area,ox,oy,scale) {
  const tags=area.tags;
  const civic=tags.name==='Masarykovo náměstí'||tags.name==='Jiráskovo náměstí';
  const surface = palette.technique==='daylight' && taggedSurface(palette,tags.surface);
  if (surface && surface[1]!=='setts') {
    return (x,y)=>shade(surface[0],Math.round(landscapeGrain(surface[1],(x+ox)/scale,(y+oy)/(scale*region.pitch),23,-.55,.835,palette,scale)));
  }
  const stone=civic ? palette.plaza : palette.paving;
  const sett=tags.surface==='sett';
  const postcard=palette.postcard;
  const gap=scale<1.6 ? .18 : .13;
  // Setts become broad bands at city scale. The much smaller joints appear
  // only when the pixels can represent the individual paving blocks.
  const along=sett ? 1.16 : 2.8;
  const across=sett ? .73 : 1.8;
  return (x,y)=>{
    const wx=(x+ox+.5)/scale;
    const wy=(y+oy+.5)/(scale*region.pitch);
    const row=(-.55*wx+.835*wy)/across;
    const col=(.835*wx+.55*wy)/along+(Math.floor(row)&1)*.5;
    const shadeStone=noise(Math.floor(row),Math.floor(col),23)-.5;
    const joint=scale>=2.2&&(mod(row,1)<gap||mod(col,1)<.09);
    const course=civic&&(mod(row,18)<.59||mod(col,26)<.42);
    if (postcard && civic) {
      const ochre=postcard==='ochre';
      const cross=mod(row,ochre?17:10);
      const border=ochre ? cross<.75 || cross>15.9 : mod(col,13)<.8;
      const tier=ochre && (border || cross>14.7) ? mix(stone,0x9f8171,border?.42:.20) :
        !ochre && border ? mix(stone,0x758891,.35) : stone;
      return shade(tier,Math.round(shadeStone*13+(joint?-13:2)));
    }
    return shade(stone,Math.round(shadeStone*(scale>2.2 ? 10 : 5)+(course ? -15 : joint ? -8 : 1)));
  };
}

export function litWall(palette,base,lit,working) {
  if (palette.technique==='daylight') {
    const sun=palette.light?.wallSun??.21, shade=palette.light?.wallShade??.34;
    return lit ? mix(base,palette.sunlight,working ? sun-.02 : sun) :
      mix(base,palette.plasterShade,working ? shade+.08 : shade);
  }
  if (palette.technique==='lithograph') {
    return lit ? mix(base,palette.sunlight,.14) : mix(base,palette.plasterShade,.47);
  }
  if (lit) return mix(base,palette.sunlight,working ? .19 : .16);
  const warm=palette===mapStyles.atlas;
  return mix(base,palette.plasterShade,working ? (warm ? .37 : .46) : warm ? .24 : .38);
}

export function roofLight(palette,pigment,amount) {
  if (palette.technique==='daylight') {
    const tone=shade(pigment,Math.round(amount*1.22));
    return amount>=0 ? mix(tone,palette.sunlight,amount*(palette.light?.roofSun??.0056)) : mix(tone,palette.shadow,-amount*.005);
  }
  if (palette.technique==='lithograph') {
    const grade=amount>9 ? 20 : amount< -9 ? -19 : 0;
    return grade>0 ? mix(shade(pigment,grade),palette.sunlight,.12) : shade(pigment,grade);
  }
  const warm=palette===mapStyles.atlas;
  const surface=shade(pigment,Math.round(amount*(warm?1.14:1.36)));
  return amount>=0 ? mix(surface,palette.sunlight,(warm ? .115 : .077)*amount/26) :
    mix(surface,palette.shadow,-amount*(warm ? .085 : .14)/26);
}

export function flatSurface(kind,salt,along,across) {
  if (kind==='steel'||kind==='zinc'||kind==='copper') {
    const spacing=kind==='steel' ? 1.25 : 1.07;
    const u=mod(across,spacing);
    const band=Math.floor(across/spacing);
    const v=mod(along+(band&1)*2.2,6.2);
    const tint=(noise(band,Math.floor(along/6.2),salt)-.5)*9;
    return Math.round(tint+(u<.16 ? -19 : u<.37 ? 12 : v<.18 ? -12 : 1));
  }
  const roll=mod(across,2.18);
  const cross=mod(along,12.4);
  const weather=noise(Math.floor(across/6.54),Math.floor(along/8.2),salt);
  return Math.round((weather-.5)*11+(roll<.22 ? -9 : roll<.39 ? 3 : cross<.20 ? -6 : 0));
}

export function miniatureRoof(palette,material,along,across,scale,flat=false) {
  const {kind,salt}=material;
  const print=palette.technique==='lithograph';
  if (kind==='steel'||kind==='zinc'||kind==='copper') {
    const span=kind==='steel' ? 1.52 : 1.16;
    const lane=Math.floor(across/span);
    const seam=mod(across,span);
    const lap=kind==='steel' ? 6.1 : 4.7;
    const course=Math.floor((along+(lane&1)*lap*.5)/lap);
    const panel=(noise(lane,course,salt)-.5)*(kind==='steel' ? 20 : 11);
    return Math.round(panel+(seam<.19 ? -16 : !print && seam<.44 ? 12 :
      scale>=1.45 && mod(along+(lane&1)*lap*.5,lap)<.24 ? -12 : 0));
  }
  if (flat||kind==='felt') {
    const course=mod(across,print ? 2.84 : 3.6);
    const weather=noise(Math.floor(across/7.2),Math.floor(along/8.1),salt);
    return Math.round((weather-.5)*12+(course<.24 ? -11 : !print && course<.52 ? 6 : 0));
  }
  const clay=kind==='clay';
  const width=clay ? .91 : 1.07;
  const height=clay ? .70 : .86;
  const row=Math.floor(across/height);
  const lap=mod(across,height)/height;
  const col=along/width+(row&1)*.5;
  const joint=mod(col,1);
  const tile=noise(Math.floor(col),row,salt);
  if (print) return lap<.29 && (row&1) ? -17 : tile>.80 ? 6 : 0;
  if (scale<1.45) return lap<.19 ? -9 : lap>.67 ? 5 : 0;
  const ripple=clay && joint>.24 && joint<.69;
  if (lap<.15 || scale>=2.7 && joint<.10) return clay ? -15 : -12;
  if (ripple && lap>.68) return 10+(tile>.65 ? 6 : 0);
  return tile<.19 ? -7 : tile>.73 ? 7 : 0;
}

export function foliagePigment(base,tone,light,variation) {
  const lit=light>0 ? mix(shade(base,light),tone,.20) : mix(shade(base,light),0x294f43,.19);
  // The moving canopy samples these colors. Keep greens distinct from
  // pavement and keep even the brightest leaves in its current mask range.
  const green=Math.min(161,(lit>>8&255)+variation);
  const red=Math.min(green,(lit>>16)+variation);
  const blue=Math.min(green-19,(lit&255)+variation);
  return (Math.max(0,red)<<16)|(Math.max(0,green)<<8)|Math.max(0,blue);
}
