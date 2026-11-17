import { region, toGeographic } from '../public/js/geo.js';
import { Raster, rgb, shade, noise, mix } from './raster.mjs';
import * as landmarkArt from './models.mjs';
import { architecturalFamily, buildingContext, illuminated, pigments } from './art-stock.mjs';
import { buildRoof, roofLight } from './roof-shapes.mjs';
import { shadeRelief } from './relief.mjs';
import { paintStreetDetails } from './street-art.mjs';
import { arterial, isBelowSurface, lightWay, offsetPath, paintTransport } from './transport.mjs';
import * as pilotArt from './pilot-materials.mjs';
import * as atlasArt from './atlas-materials.mjs';
import { facadeArchitecture, metres } from './facade-architecture.mjs';
import { buildingArchetype, miniatureWall, sharedPartyWalls } from './miniature-buildings.mjs';
import { roofFixtures } from './roof-fixtures.mjs';

export const outside = rgb('dcdfce');
const lightAngle = { east: 0.72, south: 0.69 };
const cachedRoofs = new Map();
const maxCachedRoofs = 12000;

export function paintSection({ scale, ox, oy, width, height, layers, landmarks, screen, relief, recordTree, recordRoof, pilot, style }) {
  const palette = Object.hasOwn(atlasArt.mapStyles,style) ? atlasArt.mapStyles[style] : undefined;
  const miniature=palette?.technique;
  const replacements=landmarkArt.curatedLandmarkReplacements?.(landmarks,style);
  const ground = palette?.ground ?? (pilot==='centre' ? 0xa4b27d : pilot==='ironworks' ? 0xa1a478 : rgb('a5b17b'));
  const map = new Raster(width, height, ground, true);
  const unit = Math.max(1, scale);
  const features = (layer) => layers.get(layer) ?? [];
  const number = (text) => Number.isFinite(parseFloat(text)) ? parseFloat(text) : 0;
  const ringArea = (ring) => ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length];
    return sum + x * ny - y * nx;
  }, 0) / 2;
  const area = (f) => Math.abs(ringArea(f.rings[0]));
  const rank = (f) => Number.parseInt(f.id.slice(1), 10) | 0;

  // OSM residential use mixes yards, lawns and hard surfaces. Footprint density
  // tints that uncertain ground without drawing invented parcel or pavement edges.
  const daylight = miniature === 'daylight';
  const urban = daylight && atlasArt.groundDensity(features('building'),ox,oy,width,height,scale);
  const soilPalette = (color) => Array.from({length:21},(_,i) => mix(color,palette.urbanGround,i/20));
  const underpainting = daylight && soilPalette(ground);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pigment = urban ? underpainting[urban(x,y)] : ground;
      map.pixels[y*width+x] = texture(pigment,x,y,4);
    }
  }

  function maskContains(rings, x, y) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[j];
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
      }
    }
    return inside;
  }

  function texture(color, x, y, strength) {
    const worldX = (x+ox)/scale;
    const worldY = (y+oy)/scale;
    const grain = noise(Math.floor(worldX*2), Math.floor(worldY*2));
    if (grain < 0.93) return color;
    return shade(color,grain>0.966 ? strength : -strength);
  }

  function classifyTerrain(f) {
    const t = f.tags;
    if (t.natural === 'wood' || t.landuse === 'forest') return ['668250', 3, 10, 15];
    if (t.leisure === 'park' || t.leisure === 'garden') return ['91ab6b', 4, 8, 20];
    if (t.leisure === 'nature_reserve') return ['839a66', 4, 8, 23];
    if (t.natural === 'scrub' || t.landuse === 'orchard') return ['839260', 3, 8, 26];
    if (['grass', 'meadow', 'recreation_ground', 'village_green', 'allotments', 'cemetery'].includes(t.landuse) || t.natural === 'grassland') return ['a6b577', 4, 8, 40];
    if (t.natural === 'wetland') return ['768f75', 3, 6];
    if (t.landuse === 'farmland') return ['b8aa69', 2, 9];
    if (t.leisure === 'pitch') return ['7ca269', 7, 6];
    if (t.landuse === 'industrial') return ['a79b88', 1, 8];
    if (t.landuse === 'railway') return ['918977', 1, 6];
    if (['construction','brownfield'].includes(t.landuse)) return ['ab9a7c', 1, 9];
    if (['commercial','retail','education'].includes(t.landuse)) return ['c4b9a2', 2, 6];
    if (t.landuse === 'residential') return ['b4b785', 1, 6, 46];
    if (t.amenity === 'parking' || t.leisure === 'track') return ['959a8d', 7, 6];
    if (t.highway === 'pedestrian' || t.area === 'yes') return ['ded1b6', 8, 6];
    return null;
  }

  const roadArea = (f)=>f.tags.area==='yes' && !!f.tags.highway && !['corridor','platform','proposed','construction'].includes(f.tags.highway);
  const terrain = features('terrain').filter(f=>!roadArea(f)).map((f) => {
    const surface = daylight && atlasArt.daylightTerrain(palette,f.tags);
    const style = daylight ? surface && [null,surface[2],0,surface[3]] : classifyTerrain(f);
    return { ...f, style, surface };
  }).filter((f) => f.style);
  terrain.sort((a, b) => a.style[1] - b.style[1] || area(b) - area(a) || a.id.localeCompare(b.id));
  for (const f of terrain) {
    const [hex, , strength] = f.style;
    const surface = daylight ? f.surface : palette && atlasArt.terrainMaterial(palette,f.tags);
    const baseColor=surface?.[0] ?? (pilot ? pilotArt.groundPigment(pilot,f.tags) ?? rgb(hex) : rgb(hex));
    const salt = rank(f);
    let color = shade(baseColor,(Math.floor(noise(salt,43)*5)-2)*3);
    const yard=pilot==='ironworks' && (['industrial','railway','construction','brownfield'].includes(f.tags.landuse) ||
      f.tags.name==='Dolní oblast Vítkovice' && f.tags.area==='yes');
    const paving = f.tags.highway === 'pedestrian' || f.tags.surface === 'sett';
    const fields = f.tags.landuse === 'farmland';
    const pitch = f.tags.leisure === 'pitch';
    const sett = f.tags.surface === 'sett';
    const square = f.tags.name === 'Masarykovo náměstí';
    if (square) color=0xe4d6b9;
    // Courses follow the dominant edge of their mapped plot. The texture
    // changes direction with the property but stays within its polygon.
    let angle = 0;
    if (fields || daylight && ['orchard','allotment','concrete','setts'].includes(surface[1])) {
      let longest = 0;
      const ring=f.rings[0];
      for (let i=1;i<ring.length;i++) {
        const dx=ring[i][0]-ring[i-1][0];
        const dy=(ring[i][1]-ring[i-1][1])/region.pitch;
        const distance=dx*dx+dy*dy;
        if (distance<=longest) continue;
        longest=distance;
        angle=Math.atan2(dy,dx);
      }
    }
    const fieldX = -Math.sin(angle);
    const fieldY = Math.cos(angle)/region.pitch;
    const fieldNorth = Math.cos(angle);
    const housing = daylight && surface[1] === 'housing' && soilPalette(color);
    map.polygon(f.rings, (x, y) => {
      const px = (x+ox)/scale;
      const py = (y+oy)/scale;
      if (surface) {
        const shadeSurface=atlasArt.landscapeGrain(surface[1],px,py/region.pitch,salt,fieldX,fieldNorth,palette,scale);
        map.pixel(x,y,shade(housing ? housing[urban(x,y)] : color,Math.round(shadeSurface)));
        return;
      }
      if (yard) {
        map.pixel(x,y,shade(color,Math.round(pilotArt.yardGrain(px,py/region.pitch,salt))));
        return;
      }
      const diagonal = px+py*1.9;
      const cross = px-py*1.9;
      const slab = Math.floor(diagonal/2.25);
      const seam = paving && (Math.abs(diagonal%2.25)<0.19 || Math.abs((cross+(slab%2)*0.91)%1.82)<0.14);
      const inlay = square && (Math.floor(diagonal/2.25)%12===0 || Math.floor(cross/1.82)%14===0);
      const rows = fields && Math.floor((px*fieldX+py*fieldY)/3)%7===0;
      const lawn = pitch && Math.floor((px-py*1.2)/7.1)%2===0;
      const cobble = sett && scale>2.7 && noise(Math.floor(cross*1.27),Math.floor(diagonal*0.83),38)>0.88;
      map.pixel(x,y,texture(shade(color,inlay ? -8 : seam ? -4 : cobble ? 5 : rows ? -6 : lawn ? 7 : 0),x,y,strength));
    });
  }
  shadeRelief(map,{scale,ox,oy,sample:relief});

  function projectLine(points, thickness, color, { dashed = false, phase = 0, offset = 0,
    dashUnit = 3.6*unit, capStart = true, capEnd = true } = {}) {
    let along = phase;
    const original=points;
    if (offset) points=offsetPath(points,offset);
    const paintPixel=typeof color==='function' ? color : (x,y)=>map.pixel(x,y,color);
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const dx = bx - ax;
      const dy = by - ay;
      // The pen is circular in ground space, elliptical on screen.
      const groundLength = Math.hypot(dx, dy / region.pitch);
      if (groundLength < 0.01) continue;
      const normalX = -dy/region.pitch/groundLength;
      const normalY = dx/groundLength*region.pitch;
      const rx = normalX*thickness/2;
      const ry = normalY*thickness/2;
      const start = along;
      const paint = dashed ? (x, y) => {
        const chainage=start+((x+0.5-ax)*dx+(y+0.5-ay)*dy/(region.pitch*region.pitch))/groundLength;
        if (Math.floor(Math.max(0,chainage)/dashUnit)%3===0) paintPixel(x,y);
      } : color;
      map.polygon([[[ax+rx,ay+ry],[bx+rx,by+ry],[bx-rx,by-ry],[ax-rx,ay-ry]]],paint);
      if (!dashed && (i>1 || capStart)) map.ellipse(ax,ay,thickness/2,thickness*region.pitch/2,paintPixel);
      if (!dashed && i===points.length-1 && capEnd) map.ellipse(bx,by,thickness/2,thickness*region.pitch/2,paintPixel);
      along += offset ? Math.hypot(original[i][0]-original[i-1][0],(original[i][1]-original[i-1][1])/region.pitch) : groundLength;
    }
  }

  const water = palette?.openWater ?? rgb('4c8290');
  const bank = palette?.bank ?? rgb('8f9b71');
  const shore = palette?.bankRim ?? rgb('b1b38d');
  const waterFill = (x, y) => {
    const gx = (x+ox)/scale;
    const gy = (y+oy)/scale;
    const surface = Math.floor(gy*1.6);
    const wave = noise(Math.floor((gx+surface*7)/7),surface,918)>0.94 &&
      Math.abs((gy*1.6)%1)<0.45;
    const current = Math.floor((gy+gx*0.22)/16);
    const tint = noise(Math.floor(gx/54),current,611)>0.67 ? 4 : 0;
    const fleck=palette ? noise(Math.floor((gx+2*gy)/13),Math.floor(gy*1.5),164)>0.963 : false;
    const depth = palette && noise(Math.floor(gx/60),current,728)>0.62 ? -3 : 0;
    map.pixel(x,y,shade(water,palette ? (wave ? 12 : fleck ? 7 : 0)+tint+depth : (wave ? 14 : 0)+tint));
  };
  for (const f of features('waterline')) {
    if (isBelowSurface(f.tags)) continue;
    const size = number(f.tags.width) || (f.tags.waterway === 'river' ? 11 : 2);
    for (const path of f.rings) projectLine(path,size*scale,water);
  }
  for (const f of features('water')) {
    for (const path of f.rings) {
      projectLine(path,6.7*scale,bank);
      projectLine(path,2.7*scale,shore);
    }
    map.polygon(f.rings, waterFill);
    for (const path of f.rings) projectLine(path,Math.max(0.7,0.50*scale),palette?.shallows ?? rgb('78a49e'));
  }

  const major = (f)=>arterial(f.tags);
  const isPath = (f)=>lightWay(f.tags);
  const transportFeatures=(kind)=>kind==='road-area' ? features('terrain').filter(roadArea) : features(kind);
  const streetFeatures=(kind)=>kind==='detail' && replacements?.details.size ?
    features(kind).filter(f=>!replacements.details.has(f.id)) : features(kind);
  const transportStyle=miniature==='daylight' ? 'atlas' : miniature==='lithograph' ? 'foundry' : style;
  const roads=paintTransport({map,scale,features:transportFeatures,projectLine,pilot,style:transportStyle,ox,oy,
    areaSurface:palette ? (area)=>atlasArt.pavingSurface(palette,area,ox,oy,scale) :
      pilot ? (area)=>pilotArt.pavingSurface(pilot,area,ox,oy,scale) : undefined,
    paintGrade(tier,grade) {
    paintStreetDetails({map,scale,features:streetFeatures,roads:tier,projectLine,boxRing,grade,onlyCrossings:true});
  }});
  paintStreetDetails({map,scale,features:streetFeatures,roads,projectLine,boxRing,onlyCrossings:false});

  // Decorative cars stay in mapped road lanes. Trams are drawn from the live rail overlay.
  function vehicles(lines) {
    const colors = ['ece2c8','b04b40','709cca','456775','dcb057','62766c'].map(rgb);
    const glass = rgb('455d69');
    const tire = rgb('424d50');
    for (const f of lines) {
      const seed = rank(f);
      if (noise(seed,15)>0.36) continue;
      const route = f.rings[0];
      const i = Math.max(1, Math.floor(route.length / 2));
      const [ax, ay] = route[i - 1];
      const [bx, by] = route[i];
      const dx = bx - ax;
      const dy = by - ay;
      const distance = Math.hypot(dx, dy / region.pitch);
      if (distance<13*scale) continue;
      const lane=f.size*0.22*(noise(seed,52)<0.5 ? -1 : 1);
      const x = (ax+bx)/2 - dy/region.pitch/distance*lane;
      const y = (ay+by)/2 + dx/distance*lane*region.pitch;
      const half = 2.3*scale;
      const vx = dx/distance*half;
      const vy = dy/distance*half;
      const surface = (elevation, low, high) => [[x+vx*low,y+vy*low-elevation],[x+vx*high,y+vy*high-elevation]];
      const color = colors[Math.floor(noise(seed,37)*colors.length)];
      projectLine(surface(0,-1.07,1.11),2.25*unit,tire);
      projectLine(surface(0.83*unit,-1,1),1.98*unit,color);
      projectLine(surface(1.65*unit,-0.52,0.49),1.69*unit,glass);
      projectLine(surface(1.95*unit,-0.36,0.40),1.53*unit,shade(color,31));
    }
  }
  if (!miniature) vehicles(roads.filter((f) => major(f) || f.tags.highway === 'residential'));

  if (!miniature && scale > 1.5) {
    const clothes = [0x7c9bae,0xb37557,0xe6d1a2,0x597468,0x455260];
    for (const way of roads) {
      if (!isPath(way) || way.tags.highway === 'steps' || noise(rank(way),68) > 0.30) continue;
      const route = way.rings[0];
      const index = Math.max(1,Math.floor(route.length/2));
      const [ax,ay] = route[index-1];
      const [bx,by] = route[index];
      if (Math.hypot(bx-ax,by-ay) < 14*scale) continue;
      const x = Math.round(ax+(bx-ax)*0.55);
      const y = Math.round(ay+(by-ay)*0.55);
      const course = Math.floor(noise(rank(way),781)*clothes.length);
      map.ellipse(x+0.3*unit,y,0.92*unit,0.45*unit,(px,py) => map.pixel(px,py,0x938a79));
      map.pixel(x,y-1,0x565252,y+0.20);
      map.pixel(x,y-2,clothes[course],y+0.62);
      map.pixel(x,y-3,0xd3b082,y+1.0);
    }
  }

  const colors = { red:'a54937', brown:'75594a', green:'678e74', white:'e5e3ce', grey:'858e90', gray:'858e90', black:'434c4d', yellow:'e8cb91', beige:'d5c4a3', blue:'638a9d' };
  function taggedColor(key, fallback) {
    if (!key) return fallback;
    const hex = colors[key.toLowerCase()] ?? key;
    return /^(#)?[0-9a-f]{6}$/i.test(hex) ? mix(fallback,rgb(hex),0.64) : fallback;
  }

  const adjacentHomes=miniature ? sharedPartyWalls(features('building'),region.pitch) : null;
  function buildingStyle(f) {
    const t = f.tags;
    const footprint = f.worldRings ? Math.abs(ringArea(f.worldRings[0]))/region.pitch : area(f)/(scale*scale*region.pitch);
    const type = t['building:part'] || t.building;
    const salt = rank(f);
    const isIndustrial = /^(industrial|warehouse|manufacture|service|transformer_tower)$/.test(type);
    const listedLevels = number(t['building:levels']);
    const panel = /^(apartments|residential)$/.test(type) && listedLevels >= 6;
    const isModern = panel || /^(commercial|office|retail|mall|hotel)$/.test(type);
    const small = /^(garage|garages|shed|hut|roof|outbuilding|cabin|carport)$/.test(type);
    const civic = /^(church|cathedral|chapel|civic|castle|government|train_station)$/.test(type);
    const [x,y] = f.rings[0][0];
    const [lon,lat] = toGeographic((x+ox)/scale,(y+oy)/scale);
    const family = architecturalFamily(lon,lat,{industrial:isIndustrial,modern:isModern,panel});
    const roofShape = t['roof:shape'];
    const heritage = family==='town' || family==='poruba' || civic;
    const forms=palette ? ['gabled','hipped','pyramidal','half-hipped','skillion','lean_to','gambrel','mansard','saltbox','round'] : ['gabled','hipped','pyramidal','half-hipped'];
    let pitched = forms.includes(roofShape) ||
      (!isIndustrial && !isModern && !small && roofShape !== 'flat' && footprint < (heritage ? 2300 : 1650));
    let span=0;
    let architecture;
    if (miniature) {
      const ring=f.worldRings?.[0] ?? f.rings[0].map(([x,y])=>[(x+ox)/scale,(y+oy)/scale]);
      const [left,top,right,bottom]=ring.reduce(([l,t,r,b],[x,y])=>[
        Math.min(l,x),Math.min(t,y),Math.max(r,x),Math.max(b,y),
      ],[Infinity,Infinity,-Infinity,-Infinity]);
      for (let i=1;i<ring.length;i++) {
        span=Math.max(span,Math.hypot(ring[i][0]-ring[i-1][0],(ring[i][1]-ring[i-1][1])/region.pitch));
      }
      const context=buildingContext(...toGeographic((left+right)*.5,(top+bottom)*.5));
      architecture=buildingArchetype({id:f.id,tags:t,context,footprint,span,small,industrial:isIndustrial,civic,
        levels:listedLevels,salt,attached:adjacentHomes.has(f.id)});
      if (!roofShape) {
        if (architecture.flat||architecture.type==='works') pitched=false;
        else if (architecture.type==='poruba'||architecture.type==='colony') pitched=footprint<2200;
      }
    }
    let [roof,wall] = pigments(salt,family);
    const material=palette ? atlasArt.atlasBuilding(style,architecture?.family ?? family,t,salt,{small,civic,architecture,pitched}) :
      pilot ? pilotArt.buildingMaterials(pilot,t,salt,{industrial:isIndustrial,modern:isModern,small,civic,footprint}) : undefined;
    if (material) [roof,wall]=[material.roof,material.wall];
    if (!palette) {
      if (t['roof:material'] === 'metal') roof = mix(roof,0x8aa4a2,0.58);
      if (t['roof:material'] === 'roof_tiles') roof = mix(roof,0xbc6a49,0.60);
      if (t['building:material'] === 'brick') wall = mix(wall,0xb87559,0.64);
      if (civic) [roof, wall] = [rgb('887052'), rgb('e1cb9e')];
    }
    if (f.id === 'r6827528') [roof, wall] = [rgb('628e77'), rgb('e3c997')];
    if (['w462065473', 'w462065474', 'w462065476', 'w462065477'].includes(f.id)) {
      [roof, wall] = [rgb('5d877c'), rgb('79a18b')];
    }
    if (f.id === 'w78540797') [roof, wall] = [rgb('646460'), rgb('915f47')];
    if (f.id === 'w78540952') [roof, wall] = [rgb('75634d'), rgb('875e46')];
    if (f.id === 'r3267162') [roof,wall] = [0x9c947f,0x887c69];
    if (f.id === 'w54224957') [roof, wall] = [rgb('a3573c'), rgb('995841')];
    if (f.id === 'w47987365') [roof, wall] = [rgb('a2533b'), rgb('e6bd82')];
    if (f.id === 'w38935068' || ['w33679724','w33679723'].includes(f.id)) {
      [roof, wall] = [rgb('b96b43'), rgb('e7bd86')];
    }
    if (['w462065478','w462065480','w462065479'].includes(f.id)) {
      [roof, wall] = [rgb('6e968b'), rgb('dbc296')];
    }
    roof = taggedColor(t['roof:colour'],roof);
    wall = taggedColor(t['building:colour'],wall);
    const taggedHeight = metres(t.height);
    const estimated = palette ? atlasHeight(footprint,family,{small,civic}) :
      small ? 3.1 : isIndustrial ? (footprint > 450 ? 11 : 6.5) : civic ? 18 : footageHeight(footprint);
    const facade=palette ? facadeArchitecture({civic,industrial:isIndustrial,panel,modern:isModern,heritage,small,levels:listedLevels},salt) : null;
    const total = Math.min(145, Math.max(2.5, taggedHeight || (listedLevels ? listedLevels * (facade?.floors ?? 3.05) :
      estimated + (noise(salt, 12) - 0.5) * 3.5)));
    const towerBase = { w462065474:21, w462065476:76.8, w462065477:80.8 };
    const minimum = Math.max(0, Math.min(total - 1, towerBase[f.id] ?? (metres(t.min_height) || number(t['building:min_level'])*(facade?.floors ?? 3.05))));
    const styleHeight = f.id === 'w38935068' ? 32 : f.id === 'r3267162' ? 2.7 : total;
    const brick = material?.brick ?? (t['building:material']==='brick' || (isIndustrial && noise(salt,28)>0.25));
    const shopfront = family==='town' && (t.building==='retail' || t.building==='commercial' || noise(salt,41)>0.68);
    const compactGable=palette && !roofShape && !small && !civic && !isModern && !isIndustrial &&
      (family==='houses' || family==='town') && footprint<450 && noise(salt,71)>(family==='houses' ? .27 : .52);
    const doorway=palette && (/^(garage|garages|shed|warehouse|service|industrial)$/.test(type));
    return { roof,wall,total:styleHeight,minimum,pitched,isModern,panel,civic,heritage,brick,shopfront,family,compactGable,doorway,facade,architecture,span,
      small:small||f.id==='r3267162',portal:f.id==='w38935068',industrial:isIndustrial||f.id==='w78540797',ribbed:f.id==='w78540797', material };
  }

  function footageHeight(footprint) {
    if (footprint > 600) return 15;
    if (footprint > 330) return 12.8;
    return footprint > 120 ? 9.4 : 6.1;
  }
  function atlasHeight(footprint,family,{small,civic}) {
    if (small) return 3.25;
    if (civic) return 18.5;
    if (family==='industry'||family==='ironworks') return footprint>1700 ? 13 : footprint>460 ? 10 : 6.8;
    if (family==='town'||family==='poruba') return footprint>650 ? 16.3 : footprint>315 ? 13.7 : footprint>125 ? 10.8 : 7.8;
    if (family==='houses') return footprint>440 ? 12.2 : footprint>180 ? 8.8 : 6.25;
    return footprint>850 ? 13.5 : footprint>280 ? 10.5 : 7.4;
  }
  const buildings = [...features('building'),...features('part')]
    .filter((f)=>area(f)>1.6 && !landmarkArt.modeledBuildingIds?.has(f.id) &&
      !(palette && landmarkArt.modeledAtlasBuildingIds?.has(f.id)) && !replacements?.buildings.has(f.id))
    .map((f)=>({ ...f,design:buildingStyle(f) }));

  // Accumulate the strongest occlusion so neighboring building shadows do not
  // darken each other. A short penumbra is sampled in world units at each level.
  const shadowMask = new Uint8Array(width*height);
  function shadow(rings,length,minimum) {
    const offsetX=Math.min(length*lightAngle.east,88*scale);
    const offsetY=Math.min(length*lightAngle.south*region.pitch,48*scale);
    const offsets=length>13*scale ? [0,0.14,0.30,0.46,0.62,0.76,0.88,1] : [0,0.19,0.42,0.66,0.86,1];
    if (palette && minimum<.4) {
      // Contact darkening stays tight to the mapped footprint, independently
      // of the length of the softer shadow cast further down the block.
      const contact=rings.map(ring=>ring.map(([x,y])=>[x+.64*scale,y+.48*scale*region.pitch]));
      map.polygon(contact,(x,y)=>{ shadowMask[y*width+x]=152; });
    }
    for (const step of offsets) {
      const strength=palette ? Math.round((miniature==='daylight' ? 127 : style==='foundry'||miniature==='lithograph' ? 146 : 134)-
        (miniature==='daylight' ? 72 : 54)*step) :
        pilot ? Math.round(123-45*step) : Math.round(101-36*step);
      map.polygon(rings.map((r)=>r.map(([x,y])=>[x+offsetX*step,y+offsetY*step])),(x,y)=>{
        const at=y*width+x;
        if (shadowMask[at]<strength) shadowMask[at]=strength;
      });
    }
  }
  for (const f of buildings) shadow(f.rings, f.design.total * scale,f.design.minimum);
  const softness=Math.max(1,Math.round((miniature==='daylight' ? .88 : palette ? .57 : .75)*scale));
  const shadowTone=palette?.shadow ?? (pilot==='ironworks' ? 0x30383b : pilot==='centre' ? 0x3a4350 : 0x405052);
  for (let y=softness;y<height-softness;y++) {
    const row=y*width;
    for (let x=softness;x<width-softness;x++) {
      const at=row+x;
      const alpha=shadowMask[at]*4+shadowMask[at-softness]+shadowMask[at+softness]+
        shadowMask[at-softness*width]+shadowMask[at+softness*width];
      if (!alpha) continue;
      map.pixels[at]=mix(map.pixels[at],shadowTone,alpha/(255*8));
      if (map.depth[at]<0) map.depth[at]=0;
    }
  }

  // Pixel façades interpolate real frontage distance and elevation for windows and trim.
  const rise = (meters) => meters * scale * Math.sqrt(1 - region.pitch ** 2);
  function wallFace(a, b, base, top, design, salt, orientation=0, courtyard=false) {
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    if (Math.abs(dx) < 0.08) return;
    const length = Math.hypot(dx, dy / region.pitch);
    const material=design.material;
    const lit = palette && material && orientation ? (dx*lightAngle.south-dy/region.pitch*lightAngle.east)*orientation>0 : dy/dx>0;
    const wall = material ? (palette ? atlasArt.litWall(palette,design.wall,lit,material.working) : pilotArt.wallLight(design.wall,lit,material.working)) : illuminated(design.wall,lit);
    const trim = mix(wall,lit ? (material?.trim ?? 0xffecc6) : 0xb4b5a6,material ? 0.46 : 0.36);
    const dark = mix(wall,material ? 0x292d34 : 0x343e40,0.53);
    const face=[[[ax,ay-base],[bx,by-base],[bx,by-top],[ax,ay-top]]];
    if (design.architecture) {
      const pigment=miniatureWall({design,palette,lit,wall,trim,dark,length,height:top-base,rise,scale,courtyard,salt});
      map.polygon(face,(x,y)=>{
        const u=(x+.5-ax)/dx;
        const groundY=ay+u*dy;
        const above=groundY-y-.5-base;
        map.pixel(x,y,pigment(u,above,x+ox,y+oy),groundY+(above+base)*.45);
      });
      return;
    }
    const glass = material ? (lit ? 0x8ca5a4 : 0x607b86) : lit ? 0x81989c : 0x576c70;
    const window = material ? (lit ? 0x374449 : 0x303940) : lit ? 0x3d4749 : 0x344247;
    const facade=design.facade;
    const floorHeight=facade?.floors ?? (design.industrial ? 5 : 3.1);
    const floors = Math.max(1,facade?.levels ? Math.ceil(facade.levels-design.minimum/floorHeight) : Math.round((top-base)/rise(floorHeight)));
    const floor = (top - base) / floors;
    const windowSpacing = facade?.spacing ?? (design.industrial ? 5.7 : design.isModern ? 3.45 : design.heritage ? 3.22 : 3.9);
    const bays = Math.max(1,Math.round(length/(windowSpacing*scale)));
    const roofLip = design.heritage ? 1.0 : 0.57;
    const openings = !design.small && length>3.5*scale;
    const curved = design.heritage && noise(salt,bays,610)>0.42;
    const detailed = scale>=1.5;
    const joists = design.brick && detailed;
    const storefront = design.shopfront && length>8.8*scale;
    const plinth=facade ? rise(facade.plinth) : .40*unit;
    const storeTone = noise(salt,bays,23)>0.5 ? 0x476565 : 0x835743;
    map.polygon(face, (x, y) => {
      const u = (x + 0.5 - ax) / dx;
      const groundY = ay + u * dy;
      const above = groundY - y - 0.5 - base;
      const storey = above/floor;
      const band = storey%1;
      const bayIndex=Math.floor(u*bays);
      const bay = u*bays-bayIndex;
      const edge = Math.min(u, 1-u) * length;
      const front = openings && edge>0.76*scale;
      let color = wall;
      const bayLeft = facade?.left ?? (design.isModern ? 0.12 : 0.22);
      const bayEnd = facade?.right ?? (design.isModern ? 0.88 : design.industrial ? 0.74 : 0.71);
      const crown = curved && band>0.66;
      const arch = !crown || (((bay-0.465)/0.250)**2+((band-0.66)/0.17)**2<=1);
      if (above<plinth || edge<0.33*unit) {
        color = facade && above>plinth*.67 ? shade(wall,-18) : dark;
      } else if (design.portal && length>10*scale && Math.abs(u-0.51)<0.20 && above<rise(17-26*(u-0.51)**2)) {
        color = Math.abs(u-0.51)>0.176 ? trim : 0x3e4544;
      } else if (design.ribbed && (u<0.18 || u>0.83)) {
        color = shade(wall,17);
      } else if (top-base-above<roofLip*unit) {
        color = top-base-above<0.32*unit ? shade(trim,palette ? 18 : 8) : dark;
      } else if (palette && design.doorway && storey<.75 && edge>scale && Math.abs(bay-.5)<.29) {
        color=band>.63 ? trim : band>.53 ? dark :
          Math.floor(above/(unit*.32))%3===0 ? shade(dark,17) : mix(dark,design.roof,.26);
      } else if (storefront && storey<1 && front) {
        if (band>0.75 && band<0.83) color = trim;
        else if (bay>0.095 && bay<0.92 && band>0.19 && band<0.74) {
          color = bay>0.46 && bay<0.53 ? storeTone : band>0.55 ? shade(storeTone,8) : window;
          if (detailed && band>0.57 && bay<0.14) color = glass;
        } else if (band<0.21) color = mix(wall,storeTone,0.42);
      } else if (facade?.core>=0 && front && bays>=6 && (bayIndex+facade.core)%6===4 && band>.14 && band<.89) {
        color=bay>.35 && bay<.60 && band>.41 && band<.72 ? glass : mix(wall,dark,.33);
      } else if (front && bay>bayLeft && bay<bayEnd && band>(facade?.sill ?? .21) && band<(curved ? .82 : facade?.lintel ?? .77) && arch) {
        const dull = detailed && noise(salt,Math.floor(u*bays)+37*Math.floor(storey),447)>0.82;
        const frame = detailed && (!design.industrial && (bay>0.44 && bay<0.49 || band>0.54 && band<0.61));
        color = band<0.29 ? dark : dull ? mix(window,wall,0.34) : frame ? mix(wall,glass,0.40) : band>0.56 ? glass : window;
        if (palette && detailed && design.heritage && band>.67 && band<.74 && (bay<bayLeft+.07 || bay>bayEnd-.06)) color=trim;
        if (design.panel && band<0.34 && bay>0.46) color = trim;
      } else if (front && design.heritage && band>0.12 && band<0.235 && bay>bayLeft-0.09 && bay<bayEnd+0.09) {
        color = band>0.175 ? trim : dark;
      } else if (facade?.dressed && front && band>.74 && band<.825 && bay>bayLeft-.055 && bay<bayEnd+.055) {
        color=band>.796 ? trim : shade(trim,-14);
      } else if (front && ((design.heritage && band>0.84 && band<0.94) || (design.panel && band>0.78 && band<0.93))) {
        color = material && design.heritage && bay>0.19 && bay<0.75 && band<0.87 ? dark :
          design.panel && bay>0.48 ? shade(wall,12) : trim;
      } else if (material && front && material.working && (bay<0.115 || bay>0.915)) {
        const pier=bay<0.065 || bay>0.96;
        color=shade(wall,pier ? (lit?18:9) : -18);
      } else if (design.panel && detailed && storey>1 && bay>0.76 && band>0.31 && band<0.74) {
        color = mix(wall,design.roof,0.27);
      } else if (design.heritage && detailed && (bay<0.10 || bay>0.93) && band>0.26 && band<0.85) {
        color = bay<0.036 ? trim : shade(wall,-9);
      } else if (joists) {
        const course = above/rise(0.31);
        const mortar = course%1<0.21;
        const joint = (u*length/(scale*0.72)+(Math.floor(course)%2)*0.5)%1<0.12;
        color = shade(wall,mortar||joint ? (material ? -16 : -10) : noise(Math.floor(u*length),Math.floor(course),salt)>0.7 ? (material ? 12 : 8) : 0);
      } else if (above<rise(0.9) || edge<0.79*scale) {
        color = shade(wall,-13);
      } else if (noise(x+ox,y+oy,salt)>0.972) {
        color = shade(wall,9);
      }
      // Depth increases toward the camera on the ground and with physical elevation.
      map.pixel(x, y, color, groundY + (above + base) * 0.45);
    });
  }

  function flatRoof(rings, top, design, salt) {
    const transformed = rings.map((ring) => ring.map(([x, y]) => [x, y - top]));
    let longest=0;
    let axisX=1;
    let axisY=0;
    const boundary=rings[0];
    if (design.isModern || design.industrial || design.material) {
      for (let i=1;i<boundary.length;i++) {
        const dx=boundary[i][0]-boundary[i-1][0];
        const dy=(boundary[i][1]-boundary[i-1][1])/region.pitch;
        const length=Math.hypot(dx,dy);
        if (length<=longest) continue;
        longest=length;
        axisX=dx/length;
        axisY=dy/length;
      }
    }
    map.polygon(transformed, (x, y) => {
      const px=(x+ox)/scale;
      const py=(y+oy+top)/(scale*region.pitch);
      const across=-px*axisY+py*axisX;
      const along=px*axisX+py*axisY;
      const sheet=design.industrial && Math.abs(across%2.15)<0.22;
      const rib=design.industrial && Math.floor(across/6.45)%4===0;
      const coping=design.isModern && Math.abs((across+salt%4)%5.6)<0.20;
      const panel=design.isModern && Math.floor(along/7.2)%3===0;
      const speckle=noise(Math.floor(px*2),Math.floor(py*2),salt)>0.979;
      const kind=design.material?.kind;
      const texture=kind ? (design.architecture ? atlasArt.miniatureRoof(palette,design.material,along,across,scale,true) :
        palette ? atlasArt.flatSurface(kind,salt,along,across) : pilotArt.flatSurface(kind==='clay'||kind==='slate' ? 'felt' : kind,salt,along,across)) :
        sheet ? -11 : rib ? 5 : coping ? -7 : panel ? 3 : speckle ? 5 : 1;
      const color=shade(design.roof,texture);
      map.pixel(x, y, color, y + 0.5 + top * 1.45 + 0.03);
    });
    for (const ring of transformed) {
      const sign=Math.sign(ringArea(ring));
      for (let i = 1; i < ring.length; i++) {
        const [x0, y0] = ring[i - 1];
        const [x1, y1] = ring[i];
        const length = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        const sun=(lightAngle.south*(x1-x0)-lightAngle.east*(y1-y0)/region.pitch)*sign>0;
        for (let j = 0; j < length; j++) {
          const x = Math.floor(x0 + (x1 - x0) * j / length);
          const y = Math.floor(y0 + (y1 - y0) * j / length);
          if (x < 0 || x >= width || y < 0 || y >= height) continue;
          map.pixel(x,y,shade(design.roof,sun ? 24 : -19),y+0.5+top*1.45+0.07);
        }
      }
    }
  }

  function slopeFace(a, b, c, color, pattern = 'tile', material) {
    const [ax, ay, az] = a;
    const [bx, by, bz] = b;
    const [cx, cy, cz] = c;
    const y0 = ay - az;
    const y1 = by - bz;
    const y2 = cy - cz;
    const det = (y1 - y2) * (ax - cx) + (cx - bx) * (y0 - y2);
    if (Math.abs(det) < 0.01) return;
    let roofAxis;
    if (material) {
      const dx1=bx-ax;
      const dx2=cx-ax;
      const dy1=(by-ay)/region.pitch;
      const dy2=(cy-ay)/region.pitch;
      const planeDet=dx1*dy2-dx2*dy1;
      if (Math.abs(planeDet)>0.01) {
        const dx=((bz-az)*dy2-(cz-az)*dy1)/planeDet;
        const dy=(dx1*(cz-az)-dx2*(bz-az))/planeDet;
        const slope=Math.hypot(dx,dy);
        if (slope>0.0001) roofAxis=[dx/slope,dy/slope,Math.hypot(1,slope)];
      }
    }
    map.polygon([[[ax,y0],[bx,y1],[cx,y2]]], (x, y) => {
      const u = ((y1-y2)*(x+0.5-cx)+(cx-bx)*(y+0.5-y2))/det;
      const v = ((y2-y0)*(x+0.5-cx)+(ax-cx)*(y+0.5-y2))/det;
      const z = cz + u*(az-cz) + v*(bz-cz);
      if (pattern==='solid') {
        map.pixel(x,y,color,Math.fround(y+.5+z*1.45+.055));
        return;
      }
      if (roofAxis) {
        const [sx,sy,distance]=roofAxis;
        const wx=(x+0.5+ox)/scale;
        const wy=(y+0.5+z+oy)/(scale*region.pitch);
        const along=-wx*sy+wy*sx;
        const across=(wx*sx+wy*sy)*distance;
        const materialLight=pilotArt.roofSurface(material.kind,material.salt,along,across);
        map.pixel(x,y,shade(color,materialLight),y+0.5+z*1.45);
        return;
      }
      if (pattern==='plaster') {
        const grain=noise(Math.floor((x+ox)/(scale*.7)),Math.floor((y+oy)/(scale*.55)),100);
        map.pixel(x,y,shade(color,grain<.12 ? -6 : grain>.88 ? 4 : 0),y+0.5+z*1.45);
        return;
      }
      const row=z/(scale*(pattern==='metal' ? 0.85 : 0.39));
      const column=(x+ox+z*0.34)/(scale*0.57);
      const join = (column+Math.floor(row)*0.5)%1;
      const tileRib = scale>1.5 && row%1>0.83;
      const tileJoint=scale>=2.5 && pattern!=='metal' && Math.abs(join)<0.12;
      const variation=noise(Math.floor(row),Math.floor(column),100)>0.89 ? 5 : 0;
      const tiling=tileRib ? -9 : tileJoint ? -4 : variation;
      map.pixel(x,y,shade(color,tiling),y+0.5+z*1.45);
    });
  }

  function roofFacet(points, design) {
    const [a]=points;
    const cross=(p,q)=>(p[0]-a[0])*(q[1]-a[1])-(q[0]-a[0])*(p[1]-a[1]);
    const b=points.reduce((furthest,p)=>Math.hypot(p[0]-a[0],p[1]-a[1])>
      Math.hypot(furthest[0]-a[0],furthest[1]-a[1]) ? p : furthest,a);
    const c=points.reduce((wide,p)=>Math.abs(cross(b,p))>Math.abs(cross(b,wide)) ? p : wide,a);
    const [ax,ay,az]=a;
    const bx=b[0]-ax, by=b[1]-ay, bz=b[2]-az;
    const cx=c[0]-ax, cy=c[1]-ay, cz=c[2]-az;
    const groundDet=bx*cy-cx*by;
    const screenDet=bx*(cy-cz)-cx*(by-bz);
    if (Math.abs(groundDet)<1e-7 || Math.abs(screenDet)<1e-7) return;

    const slopeX=(bz*cy-cz*by)/groundDet;
    const slopeY=(bx*cz-cx*bz)/groundDet*region.pitch;
    const delta=roofLight(slopeX,slopeY);
    const color=palette ? atlasArt.roofLight(palette,design.roof,delta) :
      shade(design.roof,design.material ? Math.round(delta*1.15) : delta);
    const material=design.material;
    const slope=Math.hypot(slopeX,slopeY);
    const sx=slope>1e-6 ? slopeX/slope : 0;
    const sy=slope>1e-6 ? slopeY/slope : 1;
    const distance=Math.hypot(1,slope);
    const elevationX=(bz*(cy-cz)-cz*(by-bz))/screenDet;
    const elevationY=(bx*cz-cx*bz)/screenDet;
    const screenOrigin=ay-az;
    map.polygon([points.map(([x,y,z])=>[x,y-z])],(x,y)=>{
      const z=az+elevationX*(x+.5-ax)+elevationY*(y+.5-screenOrigin);
      const wx=(x+.5+ox)/scale;
      const wy=(y+.5+z+oy)/(scale*region.pitch);
      const along=-wx*sy+wy*sx;
      const across=(wx*sx+wy*sy)*distance;
      const relief=material ? design.architecture ? atlasArt.miniatureRoof(palette,material,along,across,scale) :
        pilotArt.roofSurface(material.kind,material.salt,along,across) : 0;
      map.pixel(x,y,shade(color,relief),Math.fround(y+.5+z*1.45+.025));
    });
  }

  function boxRing(x, y, across, along, angle = 0) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([u,v]) => [
      x+(c*u*across-s*v*along)*scale/2,
      y+(s*u*across+c*v*along)*scale*region.pitch/2,
    ]);
  }

  function paintWalls(rings, base, top, design, salt) {
    for (const [ringIndex,ring] of rings.entries()) {
      for (let index=1;index<ring.length;index++) {
        // The source roof solver winds open courtyard walls in the opposite
        // direction, so a single outward-normal rule handles both sides.
        wallFace(ring[index-1],ring[index],base,top,design,salt,1,ringIndex>0);
      }
    }
  }

  function getRoof(f) {
    const d=f.design;
    const infer=d.pitched ? d.compactGable ? 'gabled' : 'hipped' : 'flat';
    const key=f.worldRings;
    const saved=key && cachedRoofs.get(key);
    if (saved && saved.total===d.total && saved.minimum===d.minimum && saved.infer===infer) return saved.plan;
    const projected=key ?? f.rings.map(ring=>ring.map(([x,y])=>[(x+ox)/scale,(y+oy)/scale]));
    const plan=buildRoof(projected,region.pitch,f.tags,{total:d.total,minimum:d.minimum,infer});
    if (key && plan.shells.some(shell=>shell.height)) {
      if (cachedRoofs.size>=maxCachedRoofs) cachedRoofs.delete(cachedRoofs.keys().next().value);
      cachedRoofs.set(key,{total:d.total,minimum:d.minimum,infer,plan});
    }
    return plan;
  }

  function paintRoofFixtures(shell,design,salt,base,toScreen) {
    const fixtures=roofFixtures(shell,design,salt,scale,region.pitch);
    const point=([x,y,h])=>[...toScreen([x,y]),base+rise(h)];
    const quad=([a,b,c,d],color)=>{
      slopeFace(a,b,c,color,'solid');
      slopeFace(a,c,d,color,'solid');
    };
    for (const fixture of fixtures) {
      const bottom=fixture.base.map(point);
      const top=fixture.top.map(point);
      const chimney=fixture.kind==='chimney';
      const skylight=fixture.kind==='skylight';
      const wall=chimney ? 0xbb8160 : skylight ? 0x554e4d : mix(design.wall,0xe7d7ad,.25);
      for (let i=0;i<4;i++) {
        const next=(i+1)%4;
        const a=bottom[i],b=bottom[next],c=top[next],d=top[i];
        const sun=(b[0]-a[0])*lightAngle.south-(b[1]-a[1])*lightAngle.east/region.pitch>0;
        quad([a,b,c,d],atlasArt.litWall(palette,wall,sun,false));
        if (fixture.kind==='dormer' && i===0) {
          const frame=(u,v)=>a.map((n,j)=>n+(b[j]-n)*u+
            (d[j]+(c[j]-d[j])*u-(n+(b[j]-n)*u))*v+ (j===2 ? .025*scale : 0));
          quad([frame(.19,.22),frame(.81,.22),frame(.81,.76),frame(.19,.76)],sun ? palette.litGlass : palette.shadeGlass);
        }
      }
      const cover=chimney ? 0x704b40 : skylight ? 0x93a7a0 : shade(design.roof,12);
      if (fixture.kind==='dormer') {
        const ridge=(a,b)=>[(a[0]+b[0])*.5,(a[1]+b[1])*.5,a[2]+rise(.19)];
        const front=ridge(top[0],top[1]);
        const back=ridge(top[3],top[2]);
        quad([top[0],front,back,top[3]],shade(cover,12));
        quad([front,top[1],top[2],back],shade(cover,-17));
        slopeFace(top[0],top[1],front,wall,'solid');
        slopeFace(top[2],top[3],back,shade(wall,-20),'solid');
      } else {
        quad(top,cover);
      }
    }
  }

  function drawBuilding(f) {
    const d=f.design;
    const salt=rank(f);
    const base=rise(d.minimum);
    const top=rise(d.total);
    const plan=getRoof(f);
    recordRoof?.(f,plan);
    const toScreen=([x,y])=>[x*scale-ox,y*scale-oy];
    for (const shell of plan.shells) {
      const rings=shell.rings.map(ring=>ring.map(toScreen));
      if (!shell.height) {
        paintWalls(rings,base,top,d,salt);
        flatRoof(rings,top,d,salt);
        if (miniature==='daylight' && f.kind==='building') paintRoofFixtures(shell,d,salt,top,toScreen);
        continue;
      }
      const eaves=rise(d.total-shell.height);
      const point=([x,y,above])=>[...toScreen([x,y]),eaves+rise(above)];
      paintWalls(rings,base,eaves,d,salt);
      // The roof rim represents the ends of a gable or the unequal sides
      // of a shed. Fill precisely up to the same roof boundary.
      for (const rim of shell.rim) {
        for (let index=1;index<rim.length;index++) {
          const a=rim[index-1], b=rim[index];
          if (a[2]<1e-6 && b[2]<1e-6) continue;
          const p=point(a), q=point(b);
          const lit=((q[0]-p[0])*lightAngle.south-(q[1]-p[1])/region.pitch*lightAngle.east)>0;
          const gable=palette ? atlasArt.litWall(palette,d.wall,lit,d.material?.working) : illuminated(d.wall,lit);
          const hp=[p[0],p[1],eaves], hq=[q[0],q[1],eaves];
          slopeFace(hp,hq,q,gable,'plaster');
          slopeFace(hp,q,p,gable,'plaster');
        }
      }
      for (const face of shell.facets) roofFacet(face.map(point),d);
      if (miniature==='daylight' && f.kind==='building') paintRoofFixtures(shell,d,salt,eaves,toScreen);
    }
  }

  for (const f of buildings) drawBuilding(f);

  landmarkArt.modelLandmarks({ map, scale, features, landmarks, screen, boxRing, rise, wallFace, flatRoof, slopeFace, pilot, style });

  const flora = [0x557a49,0x60804b,0x79944d,0x7f974e,0x58784f,0x52714a,0x899954];
  const woodland = [0x53764b,0x4f704a,0x68804c,0x5d7b4c,0x6c864f,0x5d774a];
  const planted = features('tree').map((f) => [...f.rings[0][0], rank(f), 1.12, f.tags.leaf_type === 'needleleaved']);
  for (const f of features('treeline')) {
    for (const ring of f.rings) {
      let spill = 3*scale;
      for (let index = 1; index < ring.length; index++) {
        const [ax,ay] = ring[index-1];
        const [bx,by] = ring[index];
        const length = Math.hypot(bx-ax,(by-ay)/region.pitch);
        if (!length) continue;
        let position = spill;
        while (position < length) {
          const t = position/length;
          const x = ax+(bx-ax)*t;
          const y = ay+(by-ay)*t;
          if (x > -12*scale && y > 0 && x < width+12*scale && y < height+20*scale) {
            planted.push([x,y,rank(f)+index*73+Math.round(t*390),0.96]);
          }
          position += 8.4*scale;
        }
        spill = position-length;
      }
    }
  }
  const protectedPixels = (x, y) => {
    const at = y * width + x;
    if (map.depth[at] > 1) return true;
    const color = map.pixels[at];
    return (color >> 16) < (color & 255) || ((color >> 8) & 255) - (color >> 16) < 8;
  };
  const cell = 6*scale;
  const position = (x,y)=>Math.floor((x+ox)/cell)+':'+Math.floor((y+oy)/cell);
  const explicit = new Set(planted.map(([x,y])=>position(x,y)));
  for (const f of terrain) {
    const spacing = f.style[3];
    if (!spacing) continue;
    const outer = f.rings[0];
    const dx = spacing;
    const dy = spacing*region.pitch;
    const forest=f.tags.natural==='wood' || f.tags.landuse==='forest' || f.tags.landcover==='trees';
    const scrub=f.tags.natural==='scrub';
    const isPark=f.tags.leisure==='park' || f.tags.leisure==='garden';
    const [left,top,right,bottom] = outer.reduce(([l,t,r,b],[x,y]) => [Math.min(l,x),Math.min(t,y),Math.max(r,x),Math.max(b,y)],[Infinity,Infinity,-Infinity,-Infinity]);
    const x0 = Math.floor((Math.max(0,left)+ox)/scale/dx);
    const x1 = Math.ceil((Math.min(width,right)+ox)/scale/dx);
    const y0 = Math.floor((Math.max(0,top)+oy)/scale/dy);
    const y1 = Math.ceil((Math.min(height,bottom)+oy)/scale/dy);
    const seed = rank(f);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const px = Math.floor((x+noise(x,y,seed))*dx*scale-ox);
        const py = Math.floor((y+noise(y,x,seed))*dy*scale-oy);
        if (px<0 || px>=width || py<0 || py>=height || protectedPixels(px,py) ||
            explicit.has(position(px,py)) || !maskContains(f.rings,px,py)) continue;
        const patch=noise(Math.floor((x*dx)/63),Math.floor((y*dy)/45),605);
        const thinning=forest ? 0.09+patch*0.27 : isPark ? 0.13+patch*0.30 : spacing>39 ? 0.59 : 0.28;
        if (noise(x,y,seed+4)<thinning) continue;
        const treeSeed=seed+x*117+y;
        const size=scrub ? 0.52 : (forest ? 0.89 : 0.86)+0.29*noise(x,y,seed+13);
        const pine=f.tags.leaf_type==='needleleaved' || (forest && noise(x,y,seed+22)>0.79);
        planted.push([px,py,treeSeed,size,pine,forest]);
      }
    }
  }

  function drawTree([x,y,salt,weight,conifer,forest]) {
    const radius = (3.1+3.9*noise(salt,27))*weight*scale;
    const swatches=palette ? conifer ? palette.conifers : palette.leaves : forest ? woodland : flora;
    const color=swatches[Math.floor(noise(salt,19)*swatches.length)];
    const asymmetry=(noise(salt,54)-0.5)*0.36;
    const swatch=palette ? palette.summerLeaf : noise(salt,34)>0.86 ? 0xbeb371 : 0xb7c184;
    const top = y-radius*(conifer ? 1.95 : 1.45);
    let foliage = 0;
    map.ellipse(x+radius*0.76,y+0.8*scale,radius*1.27,radius*0.55,(x,y) => {
      const at = y * width + x;
      if (map.depth[at]<0) map.pixel(x,y,mix(map.pixels[at],palette?.foliageShadow ?? 0x435745,palette ? .38 : .33),0);
    });
    map.ellipse(x,y-radius*0.25,0.64*unit,radius*0.48,(px,py) => map.pixel(px,py,0x665644,y+2));
    const crown = (cx, cy, rx, ry, detail) => map.ellipse(cx,cy,rx,ry,(px,py,dx,dy) => {
      const leaf = noise(Math.floor((px+ox)/(scale*0.55)),Math.floor((py+oy)/(scale*0.53)),salt);
      const edge = dx*dx+dy*dy;
      if (palette ? edge>.77+leaf*.21 : edge>.89 && leaf>.73) return;
      const angle = -dx*22-dy*19+detail;
      let lighting=Math.round(angle/(palette?11:8))*(palette?11:8);
      if (leaf>0.83) lighting+=7;
      if (leaf<0.13) lighting-=6;
      if (edge>0.65 && dx+dy>0) lighting-=14;
      let pigment;
      if (palette) {
        const cluster=noise(Math.floor((px+ox)/(scale*1.45)),Math.floor((py+oy)/(scale*1.1)),salt+21);
        const marks = cluster>.64 && leaf>.23 ? 7 : cluster<.28 ? -7 : 0;
        const bough=conifer && Math.floor((dy+dx*.27+1)*5)%3===0 ? -13 : 0;
        const sunfleck=miniature==='daylight' && scale>=1.45 && lighting>11 && leaf>.74 && cluster>.58 ? 5 : 0;
        const recess=miniature==='daylight' && lighting<0 && cluster<.24 ? -6 : 0;
        pigment=atlasArt.foliagePigment(color,swatch,lighting+bough+recess,marks+sunfleck);
      } else {
        pigment=lighting>0 ? mix(shade(color,lighting),swatch,0.14) : mix(shade(color,lighting),0x304e3c,0.13);
      }
      const depth=y+radius*0.48+(py-cy)*0.25+detail*0.06;
      if (recordTree && depth>=map.depth[py*width+px]) foliage++;
      map.pixel(px,py,pigment,depth);
    });
    if (palette && conifer) {
      crown(x,top+radius*.18,radius*.87,radius*.72,-19);
      crown(x-radius*.26,top-radius*.14,radius*.61,radius*.50,-2);
      crown(x+radius*.24,top-radius*.28,radius*.56,radius*.48,-6);
      crown(x-radius*.14,top-radius*.75,radius*.40,radius*.57,17);
    } else {
      crown(x,top+radius*0.18,radius,radius*0.82,-18);
      crown(x-radius*(0.45+asymmetry),top-radius*0.14,radius*0.62,radius*0.60,2);
      crown(x+radius*(0.30-asymmetry),top-radius*0.22,radius*0.54,radius*0.52,-5);
      crown(x-radius*0.14,top-radius*(conifer?0.75:0.47),radius*(conifer?0.41:0.63),radius*0.57,14);
    }
    if (recordTree && foliage>radius*radius*1.2) recordTree(x,y,radius,salt,conifer,forest);
  }

  planted.sort((a,b) => a[1] - b[1]).forEach(drawTree);

  return map;
}

