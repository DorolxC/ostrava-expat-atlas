import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { project, region, toGeographic } from '../public/js/geo.js';
import { readPbf } from './data/osm-pbf.mjs';
import { bridgeDeck, lightWay, paintTransport, roadWidth, transportState } from './transport.mjs';

const lineKinds=new Set(['road','rail','waterline']);
const polygonKinds=new Set(['terrain','water','building','part']);
const same=([x,y],[u,v])=>x===u && y===v;
const key=([x,y])=>x+','+y;
const ground=(point)=>{
  const [x,y]=project(...point);
  return [x,y/region.pitch];
};
const cellSize=40;
const lookAround=3;
const networkKey=(type,grade,position)=>type+' '+grade+' '+key(position);

function nearbyEndpoints(lines,joins,source) {
  const grid=new Map();
  const paths=lines.filter(f=>f.type==='path' && f.visible);
  const cell=([x,y])=>[Math.floor(x/cellSize),Math.floor(y/cellSize)];
  for (const f of paths) {
    const points=f.path.map(ground);
    for (let i=1;i<points.length;i++) {
      const [ax,ay]=points[i-1], [bx,by]=points[i], dx=bx-ax, dy=by-ay;
      const length2=dx*dx+dy*dy;
      if (!length2) continue;
      const [left,top]=cell([Math.min(ax,bx)-lookAround,Math.min(ay,by)-lookAround]);
      const [right,bottom]=cell([Math.max(ax,bx)+lookAround,Math.max(ay,by)+lookAround]);
      const segment={id:f.id,ax,ay,dx,dy,length2};
      for (let x=left;x<=right;x++) for (let y=top;y<=bottom;y++) {
        const at=networkKey('path',f.grade,[x,y]);
        if (!grid.has(at)) grid.set(at,[]);
        grid.get(at).push(segment);
      }
    }
  }
  const flags=[];
  for (const f of paths) for (const i of [0,f.path.length-1]) {
    const point=f.path[i];
    if (same(f.path[0],f.path.at(-1)) || joins.get(networkKey('road',f.grade,point)).count>1 ||
      source?.get(f.id)?.[i]?.noexit==='yes') continue;
    const [x,y]=ground(point);
    let gap=lookAround, target;
    for (const s of grid.get(networkKey('path',f.grade,cell([x,y])))??[]) {
      if (s.id===f.id) continue;
      const t=Math.min(1,Math.max(0,((x-s.ax)*s.dx+(y-s.ay)*s.dy)/s.length2));
      const distance=Math.hypot(s.ax+t*s.dx-x,s.ay+t*s.dy-y);
      if (distance>.15 && distance<gap) {
        gap=distance;
        target=s.id;
      }
    }
    if (target) flags.push({point,id:f.id,target,gap:Number(gap.toFixed(2))});
  }
  return flags;
}

export function sourceWays(geometry,pbf) {
  const ids=new Set(geometry.features.filter(f=>lineKinds.has(f.kind)).map(f=>Number(f.id.slice(1))));
  const nodes=new Map();
  const ways=new Map();
  for (const entry of readPbf(pbf)) {
    if (entry.type==='node') nodes.set(entry.id,{point:entry.point,noexit:entry.tags?.noexit});
    if (entry.type==='way' && ids.has(entry.id)) ways.set('w'+entry.id,entry);
  }
  return new Map([...ways].map(([id,way])=>[id,way.refs.map(ref=>({ref,...nodes.get(ref)}))]));
}

export function auditNetwork(geometry,pbf,style) {
  const source=pbf ? sourceWays(geometry,pbf) : null;
  const lines=[];
  const joins=new Map();
  let sourceChanges=0, degenerate=0;
  for (const f of geometry.features) {
    if (!lineKinds.has(f.kind)) continue;
    const {id,kind,tags,points}=f;
    const path=points[0];
    const raw=source?.get(id);
    if (source && (!raw || raw.length!==path.length ||
      raw.some(({point},i)=>!point || !same(point,path[i])))) sourceChanges++;
    if (path.length<2 || path.every(point=>same(point,path[0]))) degenerate++;
    const { grade,visible } = transportState(kind,tags,style);
    const type=kind==='road' && lightWay(tags) ? 'path' : kind;
    const width=kind==='road' ? roadWidth(tags) : kind==='rail' ? 2.5 : 0;
    const bridge=bridgeDeck(tags);
    const network=kind;
    let previous;
    for (let i=0;i<path.length;i++) {
      const point=path[i];
      const node=networkKey(network,grade,point);
      if (node===previous) continue;
      previous=node;
      const join=joins.get(node);
      if (!join) joins.set(node,{point,first:id,count:1});
      else if (join.first!==id) join.count++;
    }
    lines.push({id,type,kind,tags,path,grade,width,bridge,visible,
      ...(raw ? {source:raw.map(({point})=>point)} : {})});
  }
  return {lines,junctions:[...joins.values()].filter(j=>j.count>1).map(j=>j.point),
    flags:nearbyEndpoints(lines,joins,source),sourceCompared:Boolean(source),sourceChanges,degenerate};
}

function verifyTiles(manifest) {
  const names=new Set();
  for (const layer of [manifest,...manifest.closeups]) {
    assert(layer.scale>0 && Number.isFinite(layer.ox) && Number.isFinite(layer.oy));
    for (const [i,a] of layer.tiles.entries()) {
      assert(a.w>0 && a.h>0 && !names.has(a.name));
      names.add(a.name);
      for (const b of layer.tiles.slice(i+1)) {
        const overlaps=a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h;
        assert(!overlaps,'Overlapping tile rectangles in '+layer.name);
      }
    }
  }
  return names.size;
}

function verifyFeatures(geometry) {
  let closed=0;
  for (const f of geometry.features) {
    if (!f.points) continue;
    for (const path of f.points) {
      assert(path.length>0 && path.every(([x,y])=>Number.isFinite(x) && Number.isFinite(y) &&
        x>=-180 && x<=180 && y>=-90 && y<=90),'Invalid coordinates for '+f.id);
      if (polygonKinds.has(f.kind)) {
        assert(path.length>=4 && same(path[0],path.at(-1)),'Unclosed polygon ring '+f.id);
        closed++;
      }
      const [lon,lat]=path[0];
      const [x,y]=toGeographic(...project(lon,lat));
      assert(Math.abs(lon-x)<1e-8 && Math.abs(lat-y)<1e-8,'Projection mismatch '+f.id);
    }
  }
  return closed;
}

const sharedEnds=[
  [[18.1746946,49.8319449],'w31235285','w394751698'],
  [[18.2820359,49.8141128],'w78540696','w758897489'],
  [[18.2948333,49.8440657],'w247010256','w247010257'],
];

function verifyJunctionFaces(geometry) {
  const repairs = [
    { through: 'w46480710', branch: 'w46480716', point: [18.2998077,49.8404602] },
    { through: 'w32115913', branch: 'w41838343', point: [18.2896323,49.8489881] },
  ];
  const byId = new Map(geometry.features.filter(f=>f.kind==='road').map(f=>[f.id,f]));
  for (const { through,branch,point } of repairs) {
    const ways = [byId.get(through),byId.get(branch)];
    assert(ways[0]?.points[0].slice(1,-1).some(p=>same(p,point)),through+' lost its interior junction');
    assert(ways[1]?.points[0].some(p=>same(p,point)),branch+' no longer meets the junction');
    const features = ways.map(f=>({ ...f,rings:f.points.map(path=>path.map(p=>project(...p))) }));
    const branchRing = features[1].rings[0];
    const branchWidth = roadWidth(features[1].tags);
    let face;
    paintTransport({
      map:{},scale:1,style:'atlas',
      features:kind=>kind==='road' ? features : [],
      projectLine(path,width,color,caps) {
        if (path===branchRing && width===branchWidth) face={color,caps};
      },
    });
    const cap = same(ways[1].points[0][0],point) ? 'capStart' : 'capEnd';
    assert.equal(face?.caps[cap],false,branch+' pavement overlaps the through surface');
    assert.equal(typeof face?.color,'function',branch+' pavement is not clipped to the junction');
  }
}

export const reviewPoints=[
  {point:[18.2947759,49.8348396],detail:'Masaryk Square · endpoint 2.06 m from another path. Survey needed.'},
  {point:[18.295413,49.8364187],detail:'Kostelní · mapped noexit=yes.'},
  {point:[18.29444,49.8391376],detail:'Ostravice · elevated footbridge over a cycleway.'},
  {point:[18.16966,49.83786],detail:'Poruba · independently tagged service area restored.'},
  {point:[18.2410049,49.8369906],detail:'Černý potok · mapped underground culvert.'},
  {point:[18.2197208,49.8009569],detail:'Covered cycleway w39516671 · road surface beneath the bridge.'},
  {point:[18.2998077,49.8404602],detail:'Zámostní · branch asphalt trimmed across the mapped sett junction.'},
  {point:[18.2896323,49.8489881],detail:'Komenského sady · gravel and paved paths share a surface junction.'},
];

export async function runGeometryCheck(pbf) {
  const load=(name)=>readFile(new URL('../public/map/'+name,import.meta.url),'utf8').then(JSON.parse);
  const [geometry,manifest]=await Promise.all([load('geometry.json'),load('scene.json')]);
  const rings=verifyFeatures(geometry);
  const tiles=verifyTiles(manifest);
  const audit=auditNetwork(geometry,pbf,manifest.artStyle);
  const byId=new Map(audit.lines.map(f=>[f.id,f]));
  assert.equal(audit.sourceChanges,0,'Compiled centreline does not match the raw source');
  verifyJunctionFaces(geometry);
  for (const [point,aId,bId] of sharedEnds) {
    const [a,b]=[byId.get(aId),byId.get(bId)];
    assert(a && b && a.grade===b.grade && a.visible && b.visible,'Shared junction metadata changed');
    assert(same(a.path.at(-1),point) && same(b.path.at(-1),point),'Shared end moved');
  }
  assert.equal(byId.get('w91471810').visible,false,'Culvert is shown at surface');
  assert.equal(byId.get('w77019247').visible,false,'Pedestrian tunnel is shown at surface');
  assert.equal(byId.get('w49901474').visible,false,'Razed railway is shown at surface');
  const covered=byId.get('w39516671');
  assert(covered.tags.covered==='yes' && covered.tags.highway==='cycleway' &&
    same(covered.path.at(-1),[18.2197208,49.8009569]),'Mapped covered cycleway fixture changed');
  const atlasStyles=['atlas','foundry','daylight','lithograph'];
  for (const style of atlasStyles) assert.deepEqual(transportState(covered.kind,covered.tags,style),{ grade:0,visible:true });
  if (atlasStyles.includes(manifest.artStyle)) assert(covered.visible && covered.grade===0,'Covered cycleway is missing from the surface diagnostic');
  const coveredStream=byId.get('w218227213');
  assert(coveredStream.tags.covered==='yes' && !transportState(coveredStream.kind,coveredStream.tags,'atlas').visible,
    'Covered waterway is shown at surface');
  assert(byId.get('w376655630').grade>byId.get('w425394186').grade,'Švermova crossing grade reversed');
  assert(byId.get('w256222973').grade>byId.get('w230789225').grade,'Ostravice crossing grade reversed');
  const pavement=geometry.features.find(f=>f.id==='w672255953');
  assert(pavement?.tags.highway==='service' && pavement.tags.area==='yes' &&
    pavement.points[0].length===17,'Independent Poruba service area was lost');
  assert.equal(byId.get('w26362400').tags.junction,'roundabout','Roundabout tag was lost');
  console.log('Geometry checked: '+audit.lines.length+' centreline ways, '+rings+
    ' closed rings, '+tiles+' non-overlapping tile rectangles, '+audit.junctions.length+' grade-aware shared positions.');
  if (audit.sourceCompared) console.log('All centreline positions and vertex order match the supplied raw PBF.');
  if (audit.degenerate) console.log(audit.degenerate+' degenerate source lines flagged for review.');
  console.log(audit.flags.length+' nearby pedestrian endpoints flagged for review (0.15–3 ground metres).');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  await runGeometryCheck(process.argv[2] || process.env.OSTRAVA_OSM_PBF);
}

