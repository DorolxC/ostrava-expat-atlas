import { region } from '../public/js/geo.js';
import { noise, shade } from './raster.mjs';

const widths = {
  motorway: 9.2, trunk: 9, primary: 8.8, secondary: 8.4, tertiary: 7.6,
  motorway_link: 4.5, trunk_link: 4.4, primary_link: 4.2, secondary_link: 4, tertiary_link: 3.9,
  residential: 6.8, unclassified: 6.3, living_street: 5.4, service: 4,
  pedestrian: 5.2, track: 3, cycleway: 2.5, footway: 2.2, path: 1.7, steps: 2, bridleway: 2.3,
};

export const arterial = ({ highway }) => /^(motorway|trunk|primary|secondary|tertiary)$/.test(highway);
export const lightWay = ({ highway }) => /^(track|cycleway|footway|path|steps|pedestrian|bridleway)$/.test(highway);
export const bridgeDeck = ({ bridge }) => Boolean(bridge && bridge !== 'no');
export const isBelowSurface = ({ tunnel, covered }) => Boolean(
  (tunnel && tunnel !== 'no' && tunnel !== 'building_passage' && tunnel !== 'avalanche_protector') || covered === 'yes'
);

export function transportGrade(tags) {
  const layer = tags.layer;
  if (layer != null && /^[-+]?\d+$/.test(String(layer).trim())) return Number(layer);
  return bridgeDeck(tags) ? 1 : isBelowSurface(tags) ? -1 : 0;
}

function laneCount({ lanes }) {
  return /^\d+$/.test(lanes) ? Math.max(1,Math.min(8,Number(lanes))) : 0;
}

export function roadWidth(tags) {
  // OSM width without a suffix is in metres. Honour both metric and common
  // imperial suffixes; reject zero, blank and unrecognised composite values.
  const explicit = String(tags.width ?? '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(m|ft|feet|')?$/i);
  if (explicit && Number(explicit[1].replace(',','.'))>0) {
    const metres=Number(explicit[1].replace(',','.')) * (explicit[2] && explicit[2].toLowerCase()!=='m' ? 0.3048 : 1);
    return Math.max(0.45,Math.min(30,metres));
  }
  const count=laneCount(tags);
  if (count && !lightWay(tags)) {
    const motorway=/^(motorway|trunk)/.test(tags.highway);
    const width=motorway ? 3.55 : arterial(tags) ? 3.25 : 3.05;
    return Math.min(30,count*width+(motorway ? 1.1 : 0.55));
  }
  return widths[tags.highway] ?? 3.3;
}

const idOrder=(a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const paved=new Set(['asphalt','concrete','paving_stones','paved','sett','concrete:plates']);
const unfinished=new Set(['dirt','ground','earth','grass','compacted','fine_gravel','gravel','unpaved','sand','mud','grass_paver']);
const underRoof=(tags) => tags.tunnel==='building_passage' || tags.tunnel==='avalanche_protector';
const stonePaving = new Set(['cobblestone','sett','paving_stones','unhewn_cobblestone']);
const concreteSurface = new Set(['concrete','concrete:lanes','concrete:plates']);

const transportStyles = {
  atlas: {
    motorway: 0x657373, arterial: 0x737e7d, street: 0x8a9189, service: 0x9a9a8d,
    stone: 0xbeb39e, concrete: 0xb1afa0, dirt: 0xb7a47b, path: 0xcbba95,
    softEdge: 0xaaa17b, roadEdge: 0x747c73, kerb: 0xd9cbb0,
    vehicleDeck: 0x758181, pathDeck: 0xc4b79a, deckEdge: 0x536a6d, deckKerb: 0xc4bbab,
    markings: 0xe6ddbf,
    trackBed: 0x837669, yardBed: 0x8f7e69, tramBed: 0x798785, unusedBed: 0x938775,
    railBridge: 0x697d7c, sleepers: 0x68594d, lightRail: 0xcbc8b7, darkRail: 0x959b93, unusedRail: 0xa49b85,
  },
  foundry: {
    motorway: 0x565f63, arterial: 0x656d70, street: 0x7b817d, service: 0x8b8b7d,
    stone: 0xb1a28a, concrete: 0xa5a296, dirt: 0xa38b6b, path: 0xbda982,
    softEdge: 0x8e7f64, roadEdge: 0x5f635d, kerb: 0xc3b299,
    vehicleDeck: 0x687578, pathDeck: 0xb9aa8e, deckEdge: 0x47585f, deckKerb: 0xaaad9d,
    markings: 0xe0cda5,
    trackBed: 0x746458, yardBed: 0x826957, tramBed: 0x676d6b, unusedBed: 0x857664,
    railBridge: 0x536669, sleepers: 0x50463e, lightRail: 0xbfbeb1, darkRail: 0x898e88, unusedRail: 0x948977,
  },
};

function strokes(tags, scale, pilot, pigments) {
  const isPath=lightWay(tags);
  const deck=bridgeDeck(tags);
  const local=tags.highway==='service';
  const highway = /^(motorway|trunk)/.test(tags.highway);
  const unpaved=unfinished.has(tags.surface);
  const tracked=tags.highway==='track';
  const style = {
    edge: deck ? 0x576769 : isPath ? 0x9d9b77 : highway ? 0x6e7470 : 0x8c8c7e,
    lip: deck ? (isPath ? 0xb3a890 : 0xaaa99a) : 0xc9bfa7,
    face: deck ? (isPath ? 0xc6b798 : 0x777f7e) :
      isPath ? (tracked || unpaved ? 0xb9ac83 : paved.has(tags.surface) ? 0xc6bda5 : 0xcdbd98) :
      unpaved ? 0xa59e88 : arterial(tags) || tags.highway.endsWith('_link') ? 0x777f7e : 0x878d86,
    edgeWidth:(deck ? (isPath ? 2.35 : 2.9) : isPath ? 0.88 : highway ? 2.5 : local ? 1.6 : 2.12)*scale,
    lipWidth:(deck ? (isPath ? 1.03 : 1.5) : highway ? 1.12 : local ? 0.76 : 1.12)*scale,
    lipVisible:deck || !isPath && !unpaved && scale>=1.3,
  };
  if (pigments) {
    const { surface, highway: road } = tags;
    style.edge = deck ? pigments.deckEdge : isPath ? pigments.softEdge : pigments.roadEdge;
    style.lip = deck ? pigments.deckKerb : pigments.kerb;
    if (deck) style.face = isPath ? pigments.pathDeck : pigments.vehicleDeck;
    else if (stonePaving.has(surface)) style.face = pigments.stone;
    else if (concreteSurface.has(surface)) style.face = pigments.concrete;
    else if (unpaved || (tracked && !paved.has(surface))) style.face = pigments.dirt;
    else if (isPath) style.face = pigments.path;
    else if (highway) style.face = pigments.motorway;
    else if (arterial(tags) || road.endsWith('_link')) style.face = pigments.arterial;
    else style.face = local ? pigments.service : pigments.street;
    return style;
  }
  if (pilot && !deck) {
    if (isPath && !tracked && !unpaved) {
      style.edge=0x9e9b7e;
      style.face=pilot==='centre' ? 0xd1c4a3 : 0xbfb299;
    }
    if (!isPath && !unpaved) {
      style.face=arterial(tags) || highway ? 0x707979 : pilot==='centre' ? 0x858b85 : 0x777b73;
      style.lip=pilot==='centre' ? 0xd1c7ad : 0xb2a794;
    }
  }
  return style;
}

// A covered route can run at the surface under an open-sided bridge or roof.
// The deck and the buildings already occlude it where they are actually drawn.
function surfaceCover(tags) {
  return tags.covered==='yes' && (!tags.tunnel || tags.tunnel==='no') && Number(tags.layer??0)>=0;
}

export function transportState(kind,tags,style) {
  const atlasStyle=Object.hasOwn(transportStyles,style) || style==='daylight' || style==='lithograph';
  const restoredCover = kind!=='waterline' && atlasStyle && surfaceCover(tags);
  const grade = restoredCover && tags.layer==null ? Number(bridgeDeck(tags)) : transportGrade(tags);
  const hasSurface = !isBelowSurface(tags) || restoredCover;
  const paintedRoad = tags.highway && !['corridor','bus_stop','rest_area','services'].includes(tags.highway);
  return {
    grade,
    visible: hasSurface && (kind!=='road' || Boolean(paintedRoad)) && (kind!=='rail' || tags.railway!=='razed'),
  };
}

function bridgeJoins(features) {
  const ends = new Map();
  const coordinate = (point) => point.join(',');
  for (const feature of features) for (const path of feature.rings) {
    if (path.length<2) continue;
    for (const [point,next] of [[path[0],path[1]],[path.at(-1),path.at(-2)]]) {
      const key = coordinate(point);
      const dx=next[0]-point[0],dy=(next[1]-point[1])/region.pitch;
      const length=Math.hypot(dx,dy);
      if (length<0.01) continue;
      if (!ends.has(key)) ends.set(key,new Map());
      ends.get(key).set(feature,[dx/length,dy/length]);
    }
  }
  const joined = new Set();
  for (const [key,ways] of ends) {
    if (ways.size!==2) continue;
    const [[lower,a],[upper,b]] = Array.from(ways).sort(([a],[b])=>a.grade-b.grade);
    if (upper.grade!==lower.grade+1 || !bridgeDeck(upper.tags) || bridgeDeck(lower.tags)) continue;
    if (lower.tags.name!==upper.tags.name || lower.tags.highway!==upper.tags.highway ||
        lower.tags.railway!==upper.tags.railway) continue;
    // Straight approaches already meet with a clean abutment. The closure is
    // for angular continuations, where two butt strokes otherwise leave a gap.
    if (a[0]*b[0]+a[1]*b[1]<=Math.cos(150*Math.PI/180)) continue;
    joined.add(lower.id+' '+key);
    joined.add(upper.id+' '+key);
  }
  return (f,point) => joined.has(f.id+' '+coordinate(point));
}

// Work only from exactly shared mapped coordinates, never a proximity snap.
// Keep proper dead ends flat and round the joins of ways at the same grade.
function connectionMap(features) {
  const nodes = new Map();
  const key = (f,p)=>f.grade+' '+p[0]+','+p[1];
  for (const f of features) for (const path of f.rings) {
    const used=new Set();
    for(const vertex of path) {
      const at=key(f,vertex);
      if(used.has(at)) continue;
      used.add(at);
      if (!nodes.has(at)) nodes.set(at,f.id);
      else if (nodes.get(at)!==f.id) nodes.set(at,null);
    }
  }
  return (f,path) => {
    const first=key(f,path[0]);
    const last=key(f,path[path.length-1]);
    return {capStart:first===last || nodes.get(first)===null, capEnd:first===last || nodes.get(last)===null};
  };
}

// Keep the mapped through surface continuous where another paving material
// meets it at a shared endpoint. All the original road edges remain joined.
function junctionPavement(roads) {
  const joins = new Map();
  for (const road of roads) for (const path of road.rings) {
    for (const [i,point] of path.entries()) {
      const before = path[i-1], after = path[i+1];
      if (!before && !after) continue;
      const key = road.grade+' '+point.join(',');
      if (!joins.has(key)) joins.set(key,{point,arms:[]});
      joins.get(key).arms.push({road,before,after});
    }
  }
  const byRoad = new Map();
  for (const { point,arms } of joins.values()) {
    if (arms.length<2) continue;
    // An interior point on one way is the strongest evidence of continuity.
    const interiors = arms.filter(({before,after})=>before && after);
    let through = interiors.length===1 ? interiors : [];
    if (!interiors.length && arms.length===3) {
      const named = arms.filter(({road})=>road.tags.name &&
        arms.filter(other=>other.road.tags.name===road.tags.name && other.road.style.face===road.style.face).length===2);
      if (named.length===2) through=named;
    }
    if (!through.length) continue;
    const way = through[0].road;
    const [left,right] = through.flatMap(({before,after})=>[before,after].filter(Boolean));
    const [x,y] = point;
    const groundVector = ([nx,ny])=>[nx-x,(ny-y)/region.pitch];
    const [a,b] = [left,right].map(groundVector);
    const lengthA = Math.hypot(...a), lengthB = Math.hypot(...b);
    if (lengthA<0.01 || lengthB<0.01 || a[0]*b[0]+a[1]*b[1]>-0.75*lengthA*lengthB) continue;
    const radii = through.length===1 ? [way.size/2,way.size/2] : through.map(({road})=>road.size/2);
    const radius = Math.max(...radii);
    const segment = ([vx,vy],length,halfWidth) => {
      const dx=vx/length,dy=vy/length;
      return (px,py)=>{
        const projection=px*dx+py*dy;
        return projection>=0 && projection<=length && Math.abs(px*dy-py*dx)<halfWidth;
      };
    };
    const [leftFace,rightFace] = [segment(a,lengthA,radii[0]),segment(b,lengthB,radii[1])];
    for (const arm of arms) {
      const { road,before,after }=arm;
      if (through.includes(arm) || before && after || road.style.face===way.style.face ||
          lightWay(road.tags)!==lightWay(way.tags) || bridgeDeck(road.tags)!==bridgeDeck(way.tags) ||
          road.size>Math.min(...radii)*2.24) continue;
      const extent = road.size+radius*2;
      if (!byRoad.has(road)) byRoad.set(road,new Map());
      byRoad.get(road).set(point.join(','),(px,py)=>{
        const dx=px+0.5-x,dy=(py+0.5-y)/region.pitch;
        return Math.abs(dx)<extent && Math.abs(dy)<extent &&
          (dx*dx+dy*dy<radius*radius || leftFace(dx,dy) || rightFace(dx,dy));
      });
    }
  }
  return byRoad;
}

function surfacePaint(map,color,scale,ox,oy,material,surfaceColors) {
  if (scale<1.8) {
    surfaceColors?.add(color);
    return color;
  }
  const tones = [color,shade(color,5),shade(color,-7),shade(color,-3)];
  if (surfaceColors) for (const tone of tones) surfaceColors.add(tone);
  return (x,y)=>{
    const wx = (x+ox)/scale;
    const wy = (y+oy)/scale/region.pitch;
    const grain = noise(Math.floor(wx*2.9),Math.floor(wy*2.9),37);
    if (material==='stone') {
      const row = Math.floor(wy/.9);
      const seam = (wy/.9-row)<.12 || ((wx+(row%2)*.45)/.9%1+1)%1<.10;
      map.pixel(x,y,seam ? tones[2] : grain>.92 ? tones[1] : color);
    } else {
      const threshold = material==='aggregate' ? .77 : .93;
      map.pixel(x,y,grain>threshold ? (grain>.97 ? tones[1] : tones[3]) : grain<.025 ? tones[2] : color);
    }
  };
}

export function paintTransport({map,scale,features,projectLine,pilot,style,ox=0,oy=0,areaSurface,paintGrade=()=>{}}) {
  const pigments = Object.hasOwn(transportStyles,style) ? transportStyles[style] : undefined;
  const surfaceFeatures = (kind) => features(kind).flatMap((feature)=>{
    const { visible,grade } = transportState(kind,feature.tags,style);
    return visible ? [{ ...feature,grade }] : [];
  });
  const roads=surfaceFeatures('road').map(f=>({
    ...f,size:roadWidth(f.tags)*scale, style:strokes(f.tags,scale,pilot,pigments),
  })).sort((a,b)=>a.size-b.size || idOrder(a,b));
  const areas=surfaceFeatures('road-area').map(f=>({
    ...f,style:strokes(f.tags,scale,pilot,pigments),
  })).sort(idOrder);
  const rails=surfaceFeatures('rail').sort(idOrder);
  const roadCaps=connectionMap(roads);
  const railCaps=connectionMap(rails);
  const sharedBridgeEnd = pigments ? bridgeJoins(roads) : null;
  const pavement = pigments ? junctionPavement(roads) : new Map();
  const surfaceCaps = !sharedBridgeEnd ? roadCaps : (f,path)=>{
    const options = roadCaps(f,path);
    return {
      capStart:options.capStart || sharedBridgeEnd(f,path[0]),
      capEnd:options.capEnd || sharedBridgeEnd(f,path.at(-1)),
    };
  };
  const grades=new Set([...roads,...rails,...areas].map(f=>f.grade));
  const asphaltColors=new Set(roads.filter(f=>!lightWay(f.tags)).map(f=>f.style.face));
  for (const a of areas) asphaltColors.add(a.style.face);
  const finish = (f) => {
    const { tags } = f;
    const color = underRoof(tags) ? f.style.edge : f.style.face;
    if (!pigments) return color;
    const material = stonePaving.has(tags.surface) ? 'stone'
      : unfinished.has(tags.surface) || tags.highway==='track' ? 'aggregate' : 'smooth';
    return surfacePaint(map,color,scale,ox,oy,material,lightWay(tags) ? undefined : asphaltColors);
  };
  const draw=(f,size,color,caps=roadCaps,options)=>{
    for (const path of f.rings) if (path.length>=2) projectLine(path,size,color,{...caps(f,path),...options});
  };
  for (const grade of Array.from(grades).sort((a,b)=>a-b)) {
    const tier=roads.filter(f=>f.grade===grade);
    const tierAreas=areas.filter(f=>f.grade===grade);
    for (const f of tier) draw(f,f.size+f.style.edgeWidth,f.style.edge);
    for (const f of tier.filter(f=>f.style.lipVisible)) draw(f,f.size+f.style.lipWidth,f.style.lip);
    for (const f of tierAreas) {
      const surface=lightWay(f.tags) && areaSurface?.(f);
      map.polygon(f.rings,surface ? (x,y)=>map.pixel(x,y,surface(x,y)) : pigments ? finish(f) : f.style.face);
    }
    for (const f of tier) {
      // Carry a muted road surface under a covered passage. The mapped building
      // is still painted later and occludes this surface in the final image.
      const surface = finish(f);
      const seams = pavement.get(f);
      if (!seams) {
        draw(f,f.size,surface,surfaceCaps);
        continue;
      }
      for (const path of f.rings) {
        if (path.length<2) continue;
        const start = seams.get(path[0].join(','));
        const end = seams.get(path.at(-1).join(','));
        const options = surfaceCaps(f,path);
        projectLine(path,f.size,(x,y)=>{
          if (start?.(x,y) || end?.(x,y)) return;
          if (typeof surface==='function') surface(x,y);
          else map.pixel(x,y,surface);
        },{capStart:options.capStart && !start,capEnd:options.capEnd && !end});
      }
    }
    for (const f of tier.filter(f=>arterial(f.tags) && laneCount(f.tags)!==1 && !underRoof(f.tags) && f.tags.junction!=='roundabout')) {
      draw(f,Math.max(0.7,0.54*scale),pigments?.markings??0xdcd7c0,roadCaps,{dashed:true,dashUnit:3.55*scale});
    }
    if (pigments && scale>=2.5) {
      for (const f of tier.filter(f=>f.tags.highway==='steps' && !underRoof(f.tags))) {
        draw(f,0.78*f.size,shade(f.style.face,-17),roadCaps,{dashed:true,dashUnit:0.34*scale});
      }
    }
    for (const f of rails.filter(f=>f.grade===grade)) {
      const tram=f.tags.railway==='tram';
      const disused=f.tags.railway==='disused';
      const deck=bridgeDeck(f.tags);
      const ballast=pigments
        ? deck ? pigments.railBridge : tram ? pigments.tramBed : disused ? pigments.unusedBed
          : ['spur','yard','siding'].includes(f.tags.service) ? pigments.yardBed : pigments.trackBed
        : deck ? 0x586768 : tram ? 0x677677 : disused ? 0x837e6d : 0x746d61;
      const bedWidth=(deck ? tram ? 3.05 : 4.6 : tram ? 1.65 : 3.45)*scale;
      const bed = pigments && !tram ? surfacePaint(map,ballast,scale,ox,oy,'aggregate') : ballast;
      draw(f,bedWidth,(x,y)=>{
        // Embedded tram/level-crossing tracks retain the road surface underneath.
        if (!deck && grade===0 && asphaltColors.has(map.pixels[y*map.width+x])) return;
        if (typeof bed==='function') bed(x,y);
        else map.pixel(x,y,bed);
      },railCaps);
      if (scale<1.9) {
        const railColor = pigments ? (disused ? pigments.unusedRail : pigments.lightRail) : disused ? 0x9c927b : 0xbdb3a0;
        draw(f,Math.max(0.68,(tram ? 0.64 : 0.93)*scale),railColor,railCaps);
        continue;
      }
      if (!tram && !disused) draw(f,2.74*scale,(x,y)=>{
        if (grade!==0 || !asphaltColors.has(map.pixels[y*map.width+x])) map.pixel(x,y,pigments?.sleepers??0x544c44);
      },railCaps,{dashed:true,dashUnit:0.81*scale});
      const offset=(tram ? 0.60 : f.tags.railway==='narrow_gauge' ? 0.46 : 0.76)*scale;
      const darkRail = pigments ? (disused ? pigments.unusedRail : pigments.darkRail) : disused ? 0xa19883 : 0xb6b1a4;
      const lightRail = pigments ? (disused ? shade(pigments.unusedRail,9) : pigments.lightRail) : disused ? 0xa99e86 : 0xc8c0ac;
      draw(f,0.43*scale,darkRail,railCaps,{offset:-offset});
      draw(f,0.46*scale,lightRail,railCaps,{offset});
    }
    paintGrade(tier,grade);
  }
  return roads;
}

// The two visible rails must meet at the same corner. Offsetting independent
// segments opens the gauge on sharp curves. A bounded bisector makes a single
// shared vertex for each join without making a long spike on a switchback.
export function offsetPath(points, offset) {
  const normal = (a,b) => {
    const dx=b[0]-a[0], dy=(b[1]-a[1])/region.pitch;
    const length=Math.hypot(dx,dy);
    return length>0.01 ? [-dy/length,dx/length] : null;
  };
  const last=points.length-1;
  const closed=last>1 && points[0][0]===points[last][0] && points[0][1]===points[last][1];
  const normals=points.slice(1).map((p,i)=>normal(points[i],p));
  return points.map(([x,y],i)=>{
    const incoming=normals[i-1] ?? (closed ? normals[last-1] : null);
    const outgoing=normals[i] ?? (closed ? normals[0] : null);
    if (!incoming && !outgoing) return [x,y];
    const a=incoming ?? outgoing;
    const b=outgoing ?? incoming;
    const k=Math.min(0.94,1/Math.max(0.03,1+a[0]*b[0]+a[1]*b[1]));
    return [x+offset*k*(a[0]+b[0]),y+offset*k*(a[1]+b[1])*region.pitch];
  });
}
