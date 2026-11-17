import { noise } from './raster.mjs';

const withChimney=new Set(['townhouse','secession','plaster','poruba','detached','colony','row']);
const withDormer=new Set(['townhouse','secession','colony','row']);
const withSkylight=new Set(['shop','school','works','workshop','warehouse','office','functional']);

const cross=([ax,ay],[bx,by],[cx,cy])=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
const area=(face)=>Math.abs(face.reduce((sum,a,i)=>sum+cross(face[0],a,face[(i+1)%face.length]),0))*.5;

function roofPlane(face,pitch) {
  const points=face.map(([x,y,z])=>[x,y/pitch,z]);
  const anchor=points[0];
  const b=points[1];
  const c=points.find(p=>Math.abs(cross(anchor,b,p))>1e-5);
  if (!c) return null;
  const determinant=cross(anchor,b,c);
  const dzdx=((b[2]-anchor[2])*(c[1]-anchor[1])-(c[2]-anchor[2])*(b[1]-anchor[1]))/determinant;
  const dzdy=((b[0]-anchor[0])*(c[2]-anchor[2])-(c[0]-anchor[0])*(b[2]-anchor[2]))/determinant;
  const slope=Math.hypot(dzdx,dzdy);
  let along;
  if (slope>.01) along=[dzdy/slope,-dzdx/slope];
  else {
    const edges=points.map(([x,y],i)=>{
      const [nx,ny]=points[(i+1)%points.length];
      return [nx-x,ny-y,Math.hypot(nx-x,ny-y)];
    });
    const [dx,dy,distance]=edges.reduce((longest,edge)=>edge[2]>longest[2] ? edge : longest);
    along=[dx/distance,dy/distance];
  }
  const middle=points.reduce(([x,y],p)=>[x+p[0]/points.length,y+p[1]/points.length],[0,0]);
  const height=([x,y])=>anchor[2]+(x-anchor[0])*dzdx+(y-anchor[1])*dzdy;
  const sides=points.map((a,i)=>{
    const b=points[(i+1)%points.length];
    return [a,b,Math.hypot(b[0]-a[0],b[1]-a[1])];
  });
  const winding=Math.sign(points.reduce((sum,a,i)=>sum+cross(anchor,a,points[(i+1)%points.length]),0));
  const contains=(p)=>sides.every(([a,b,length])=>length<1e-7 || cross(a,b,p)*winding>=.54*length);
  return {along,middle,height,contains,slope};
}

function insetRectangle(plane,pitch,width,depth,offset) {
  const [cx,cy]=plane.middle;
  const [ax,ay]=plane.along;
  const corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([u,v])=>[
    cx+(u*width+offset)*ax-v*depth*ay,cy+(u*width+offset)*ay+v*depth*ax,
  ]);
  return corners.every(plane.contains) ? corners.map(([x,y])=>[x,y*pitch,plane.height([x,y])]) : null;
}

export function roofFixtures(shell,design,salt,scale,pitch) {
  if (!design.architecture || scale<1.31 || shell.reason || shell.rings.length!==1) return [];
  const type=design.architecture.type;
  if (!shell.height) {
    if (!withSkylight.has(type) || design.span<15 || noise(salt,320)<.32) return [];
    const plane=roofPlane(shell.rings[0].slice(0,-1).map(([x,y])=>[x,y,0]),pitch);
    if (!plane) return [];
    const long=type==='works'||type==='warehouse';
    const width=long ? 3.4 : 2.45;
    const offsets=long && design.span>26 ? [-width*1.45,0,width*1.45] : [0];
    return offsets.flatMap(offset=>{
      const base=insetRectangle(plane,pitch,width,long ? 1.74 : 1.22,offset);
      return base ? [{kind:'skylight',base,top:base.map(([x,y])=>[x,y,.18])}] : [];
    });
  }
  if (!withChimney.has(type) || shell.height<1.25 || noise(salt,399)<.18) return [];
  const facets=[...shell.facets].sort((a,b)=>area(b)-area(a));
  const fixtures=[];
  for (const facet of facets) {
    const plane=roofPlane(facet,pitch);
    if (!plane||plane.slope<.11) continue;
    const chimney=insetRectangle(plane,pitch,1.06,.86,0);
    if (!chimney) continue;
    const crown=Math.max(...chimney.map(p=>p[2]))+.79;
    if (crown>shell.height-.08) continue;
    const dormer=scale>=1.7 && withDormer.has(type) && design.span>=10 && noise(salt,322)>.43;
    const pair=dormer && insetRectangle(plane,pitch,1.8,1.34,3.15);
    if (pair) {
      const dormerTop=Math.max(...pair.map(p=>p[2]))+.86;
      if (dormerTop+.19<shell.height) fixtures.push({kind:'dormer',base:pair,top:pair.map(([x,y])=>[x,y,dormerTop])});
    }
    fixtures.push({kind:'chimney',base:chimney,top:chimney.map(([x,y])=>[x,y,crown])});
    break;
  }
  return fixtures;
}
