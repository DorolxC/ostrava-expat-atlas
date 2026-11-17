import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRoof } from './roof-shapes.mjs';
import { project, region, toGeographic } from '../public/js/geo.js';

const tolerance=1e-5;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=(ring)=>ring.reduce((sum,p,i)=>sum+cross(ring[0],p,ring[(i+1)%ring.length]),0)/2;
const rectangle=(w,h,x=0,y=0)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const close=(ring)=>[...ring,ring[0]];
const outer=rectangle(29,25);
const court=rectangle(15,13,7,6);
const angled=(ring,angle=.41)=>ring.map(([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)]);
const policy={total:14,minimum:0,infer:'hipped'};
const l=close([[0,0],[25,0],[25,9],[10,9],[10,22],[0,22]]);
const t=close([[0,0],[36,0],[36,9],[23,9],[23,28],[13,28],[13,9],[0,9]]);
const u=close([[0,0],[28,0],[28,24],[21,24],[21,8],[7,8],[7,24],[0,24]]);

function onEdge(p,a,b) {
  return Math.abs(cross(a,b,p))<tolerance*Math.hypot(b[0]-a[0],b[1]-a[1]) &&
    [-1,1].every((sign)=>sign*(p[0]-a[0])>=Math.min(0,sign*(b[0]-a[0]))-tolerance &&
      sign*(p[1]-a[1])>=Math.min(0,sign*(b[1]-a[1]))-tolerance);
}

function inside(ring,p) {
  let contained=false;
  for (let i=1;i<ring.length;i++) {
    const a=ring[i-1],b=ring[i];
    if (onEdge(p,a,b)) return 0;
    if ((a[1]>p[1])!==(b[1]>p[1]) && p[0]<a[0]+(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])) contained=!contained;
  }
  return contained ? 1 : -1;
}

function overlap(a,b) {
  let points=a;
  for (let j=0;points.length && j<b.length;j++) {
    const next=[];
    for (let i=0;i<points.length;i++) {
      const p=points[i],q=points[(i+1)%points.length];
      const dp=cross(b[j],b[(j+1)%b.length],p),dq=cross(b[j],b[(j+1)%b.length],q);
      if (dp>=0) next.push(p);
      if ((dp<0)!==(dq<0)) next.push(p.map((v,k)=>v+(q[k]-v)*dp/(dp-dq)));
    }
    points=next;
  }
  return points.length>=3 ? area(points) : 0;
}

function elevation(face,p) {
  const a=face[0],b=face[1],c=face[2];
  return a[2]+(b[2]-a[2])*cross(a,p,c)/cross(a,b,c)+(c[2]-a[2])*cross(a,b,p)/cross(a,b,c);
}

function verify(shell, pitch, {checkPairs=true}={}) {
  const [ring,...holes]=shell.rings;
  assert(area(ring)>0);
  for (const hole of holes) assert(area(hole)<0);
  if (shell.type==='flat') {
    assert.equal(shell.height,0);
    assert.deepEqual(shell.facets,[]);
    return;
  }
  const coverage=shell.facets.reduce((sum,face)=>sum+area(face),0);
  const expected=shell.rings.reduce((sum,p)=>sum+area(p),0);
  assert(Math.abs(coverage-expected)<Math.max(.002,expected*.000055));
  const rim=shell.rim.flat();
  const usable=(p)=>inside(ring,p)>=0 && holes.every(hole=>inside(hole,p)<=0);
  const match=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<tolerance;
  for (const [i,face] of shell.facets.entries()) {
    assert(area(face)>0);
    const center=face.reduce(([x,y],p)=>[x+p[0]/face.length,y+p[1]/face.length],[0,0]);
    assert(usable(center),'face center outside its shell');
    const closed=close(face);
    for (let j=2;j<face.length;j++) assert(cross(face[0],face[j-1],face[j])>0,`non-positive fan triangle ${JSON.stringify(face)}`);
    const grade=Math.hypot(elevation(face,[face[0][0]+1,face[0][1]])-face[0][2],
      elevation(face,[face[0][0],face[0][1]+pitch])-face[0][2]);
    assert(grade<=2.7+tolerance,'excess slope');
    for (const [j,p] of face.entries()) {
      assert(p.every(Number.isFinite) && p[2]>=0 && p[2]<=shell.height+tolerance);
      assert(Math.abs(elevation(face,p)-p[2])<tolerance,'plane is not planar');
      assert(usable(p),'face vertex outside its shell');
      const q=closed[j+1];
      assert(usable([(p[0]+q[0])/2,(p[1]+q[1])/2]),'face edge outside its shell');
      const wall=rim.find(v=>match(p,v));
      if (wall) assert(Math.abs(wall[2]-p[2])<tolerance,'wall and roof disagree');
    }
    if (!checkPairs) continue;
    for (const other of shell.facets.slice(i+1)) {
      assert(overlap(face,other)<tolerance,'two roof faces overlap in plan');
      const otherRing=close(other);
      for (const p of face) if (inside(otherRing,p)===0) assert(Math.abs(elevation(other,p)-p[2])<tolerance*3,`neighboring plane discontinuity ${JSON.stringify([p,elevation(other,p),other])}`);
      for (const p of other) if (inside(closed,p)===0) assert(Math.abs(elevation(face,p)-p[2])<tolerance*3,`neighboring plane discontinuity ${JSON.stringify([p,elevation(face,p),face])}`);
    }
  }
  for (const p of rim) {
    const match=shell.facets.find(face=>inside(close(face),p)>=0);
    assert(match && Math.abs(elevation(match,p)-p[2])<tolerance,`wall rim unsupported by a roof plane ${JSON.stringify(p)}`);
  }
}

for (const [name,rings] of [
  ['rotated narrow wing',[angled(rectangle(55,5))]],['L footprint',[angled(l)]],['T footprint',[t]],['U footprint',[angled(u)]],
  ['open courtyard',[court,outer]],['nested courtyard island',[court,rectangle(3,3,12,9),outer]],
  ['independent multipart shells',[outer,rectangle(17,12,35,2),court]],
  ['oblique concave wings',[close([[0,0],[33,1],[30,10],[15,8],[19,21],[7,25],[8,11],[-2,12]])]],
]) test(name,()=>{
  const result=buildRoof(rings,1,{},policy);
  assert(result.valid);
  for (const shell of result.shells) {
    assert(shell.height>0,`${name} uses a flat fallback`);
    verify(shell,1);
  }
  assert.equal(result.shells.length,rings.length===3 ? 2 : 1);
  assert.equal(result.shells[0].rings.length,rings.length===1 ? 1 : 2);
});

for (const type of ['flat','gabled','hipped','half-hipped','skillion','pyramidal','gambrel','mansard','saltbox','round']) {
  test('tagged roof '+type,()=>{
    const [shell]=buildRoof([rectangle(20,10)],1,{'roof:shape':type,'roof:height':'2.4 m'},policy).shells;
    assert.equal(shell.type,type);
    if (type!=='flat') assert.equal(shell.height,2.4);
    verify(shell,1);
  });
}

test('roof orientation, downhill bearing, measured height and angle',()=>{
  const ns=(r)=>r.map(([x,y])=>project(18.28+x*.00001,49.835+y*.000009));
  const [shed]=buildRoof([ns(rectangle(24,12))],region.pitch,{'roof:shape':'skillion','roof:direction':'N','roof:height':`9' 10"`},policy).shells;
  assert(Math.abs(shed.height-2.9972)<.001);
  for (const [x,y,z] of shed.rim[0]) {
    const [,lat]=toGeographic(x,y);
    assert.equal(Math.round(z),lat>49.83505 ? 0 : 3);
  }
  const [gable]=buildRoof([rectangle(24,12)],1,{'roof:shape':'gabled','roof:orientation':'across','roof:angle':20},policy).shells;
  assert(Math.abs(gable.height-12*Math.tan(20*Math.PI/180))<tolerance);
  assert(gable.facets.flat().filter(p=>p[2]>.001).every(([x])=>Math.abs(x-12)<tolerance));
  verify(shed,region.pitch);
  verify(gable,1);
});

test('duplicate and collinear points preserve their outside perimeter',()=>{
  const ring=close([[3,1],[3,1],[8,1],[15,1],[15,11],[3,11]]).reverse();
  const result=buildRoof([ring],1,{},policy);
  assert(result.valid);
  assert.equal(result.shells[0].rings[0].length,5);
  verify(result.shells[0],1);
});

test('self crossings, boundary intersections and corrupt rings stay flat',()=>{
  for (const rings of [
    [close([[0,0],[15,15],[0,15],[15,0]])], [rectangle(15,15),rectangle(8,8,10,10)],
    [outer,rectangle(7,8,0,2)], [outer,close([[0,0],[0,1],[NaN,1]])],
  ]) {
    const result=buildRoof(rings,1,{},policy);
    assert.equal(result.valid,false);
    for (const shell of result.shells) {
      assert.equal(shell.type,'flat');
      assert(shell.rings.flat(2).every(Number.isFinite));
    }
  }
  assert.deepEqual(buildRoof([[]],1,{},policy).shells,[]);
});

test('unsupported roof and little usable building height stay flat',()=>{
  assert.equal(buildRoof([outer],1,{'roof:shape':'onion'},policy).shells[0].type,'flat');
  assert.equal(buildRoof([outer],1,{'roof:shape':'gabled'},{...policy,minimum:13.8}).shells[0].type,'flat');
});

const actual=['w59009455','w59009450','w77414539','w56043010','w51784770','w51784802','w90024418','r6774746','r6838543'];
const geography=JSON.parse(await readFile(new URL('../public/map/geometry.json',import.meta.url),'utf8'));
const buildings=geography.features.filter(({kind})=>kind==='building' || kind==='part');
const found=new Map(buildings.filter(({id})=>actual.includes(id)).map(feature=>[feature.id,feature]));
for (const id of actual) test('real roof '+id,()=>{
  const feature=found.get(id);
  assert(feature,'missing regression footprint');
  const rings=feature.points.map(ring=>ring.map(p=>project(...p)));
  const plan=buildRoof(rings,region.pitch,feature.tags,policy);
  assert(plan.valid,id+' has an invalid source footprint');
  assert(plan.shells.length>=1);
  assert.equal(plan.shells[0].type,id==='w51784770' ? 'flat' : 'hipped');
  for (const shell of plan.shells) verify(shell,region.pitch);
});

test('stratified citywide geometry sample',()=>{
  let pitched=0;
  const step=Math.floor(buildings.length/320);
  for (let seed=185;seed<buildings.length;seed+=step) {
    const {id,points,tags}=buildings[seed];
    const rings=points.map(ring=>ring.map(p=>project(...p)));
    const plan=buildRoof(rings,region.pitch,tags,policy);
    if (!plan.valid) {
      assert(plan.shells.every(({type})=>type==='flat'));
      continue;
    }
    for (const shell of plan.shells) {
      assert.doesNotThrow(()=>verify(shell,region.pitch,{checkPairs:false}),id);
      if (shell.height>0) pitched++;
    }
  }
  assert(pitched>250);
});
