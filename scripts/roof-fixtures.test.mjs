import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoof } from './roof-shapes.mjs';
import { roofFixtures } from './roof-fixtures.mjs';

const pitch=.56;
const rectangle=[[0,0],[27,0],[27,12*pitch],[0,12*pitch],[0,0]];
const design=(type)=>({architecture:{type},span:27});
const policy={total:11,minimum:0};
const cross=([ax,ay],[bx,by],[cx,cy])=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);

function supported(shell,fixture) {
  return shell.facets.some(face=>{
    const [a,b]=face;
    const c=face.find(p=>Math.abs(cross(a,b,p))>1e-7);
    const det=cross(a,b,c);
    return fixture.base.every(p=>{
      if (face.some((v,i)=>cross(v,face[(i+1)%face.length],p)<-1e-8)) return false;
      const u=cross(a,p,c)/det;
      const v=cross(a,b,p)/det;
      const z=a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
      return Math.abs(z-p[2])<1e-7;
    });
  });
}

test('pitched-roof props attach to one validated plane and stay below its ridge',()=>{
  const [shell]=buildRoof([rectangle],pitch,{'roof:shape':'gabled'},policy).shells;
  const kinds=new Set();
  for (let salt=0;salt<40;salt++) {
    const fixtures=roofFixtures(shell,design('townhouse'),salt,2.7,pitch);
    assert.deepEqual(fixtures,roofFixtures(shell,design('townhouse'),salt,2.7,pitch));
    for (const fixture of fixtures) {
      assert(supported(shell,fixture));
      assert(fixture.top.every(p=>p[2]+(fixture.kind==='dormer' ? .19 : 0)<=shell.height));
      kinds.add(fixture.kind);
    }
  }
  assert.deepEqual(kinds,new Set(['chimney','dormer']));
});

test('flat skylights fit one outline and avoid courtyards and invalid roofs',()=>{
  const tags={'roof:shape':'flat'};
  const [flat]=buildRoof([rectangle],pitch,tags,policy).shells;
  const [courtyard]=buildRoof([rectangle,[[6,1],[6,5],[20,5],[20,1],[6,1]]],pitch,tags,policy).shells;
  const [invalid]=buildRoof([[[0,0],[10,6],[0,6],[10,0],[0,0]]],pitch,tags,policy).shells;
  assert(invalid.reason);
  let count=0;
  for (let salt=0;salt<40;salt++) {
    const fixtures=roofFixtures(flat,design('works'),salt,2.7,pitch);
    count+=fixtures.length;
    for (const {kind,base} of fixtures) {
      assert.equal(kind,'skylight');
      assert(base.every(([x,y,z])=>x>0 && x<27 && y>0 && y<12*pitch && z===0));
    }
    assert.deepEqual(roofFixtures(courtyard,design('works'),salt,2.7,pitch),[]);
    assert.deepEqual(roofFixtures(invalid,design('works'),salt,2.7,pitch),[]);
    assert.deepEqual(roofFixtures(flat,design('works'),salt,1.16,pitch),[]);
  }
  assert(count>0);
});
