import { projectMeters, region } from '../public/js/geo.js';

// Solve in uncompressed local metres. Neither tile origins nor output zoom
// levels take part in deciding the footprint, roof planes or wall tops.
const epsilon = 1e-7;
const minArea = 1e-5;
const value = ([a,b,c], [x,y]) => a*x+b*y+c;
const difference = ([a,b,c], [d,e,f]) => [a-d,b-e,c-f];
const negative = ([a,b,c]) => [-a,-b,-c];
const cross2 = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const lerpPoint = (a,b,t) => [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const same = (a,b) => Math.abs(a[0]-b[0])<epsilon && Math.abs(a[1]-b[1])<epsilon;
const edgesOf = (ring) => ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
const areaOf = (ring) => ring.reduce((sum,p,i)=>sum+cross2(ring[0],p,ring[(i+1)%ring.length]),0)/2;
const close = (ring) => [...ring,ring[0]];

function distinct(points) {
  const ring=[];
  for (const p of points) if (!ring.length || !same(ring.at(-1),p)) ring.push(p);
  if (ring.length>1 && same(ring[0],ring.at(-1))) ring.pop();
  return ring;
}

function normalize(points) {
  let ring=distinct(points);
  let prior;
  do {
    prior=ring;
    ring=prior.filter((p,i)=>{
      const a=prior[(i+prior.length-1)%prior.length];
      const b=prior[(i+1)%prior.length];
      const between=(p[0]-a[0])*(p[0]-b[0])+(p[1]-a[1])*(p[1]-b[1])<=0;
      return !between || Math.abs(cross2(a,b,p))>epsilon*Math.hypot(b[0]-a[0],b[1]-a[1]);
    });
  } while (ring.length>=3 && ring.length!==prior.length);
  return ring;
}

function intersect([a,b], [c,d]) {
  for (let i=0;i<2;i++) {
    if (Math.max(a[i],b[i])+epsilon<Math.min(c[i],d[i]) ||
        Math.max(c[i],d[i])+epsilon<Math.min(a[i],b[i])) return false;
  }
  const side = (p,q,r) => {
    const signed=cross2(p,q,r);
    return Math.abs(signed)<=epsilon*Math.hypot(q[0]-p[0],q[1]-p[1]) ? 0 : Math.sign(signed);
  };
  return side(a,b,c)*side(a,b,d)<=0 && side(c,d,a)*side(c,d,b)<=0;
}

function contains(ring, [x,y]) {
  let inside=false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [ax,ay]=ring[i], [bx,by]=ring[j];
    if ((ay>y)!==(by>y) && x<ax+(bx-ax)*(y-ay)/(by-ay)) inside=!inside;
  }
  return inside;
}

function footprint(rings) {
  const candidates=[];
  let valid=true;
  for (const points of rings) {
    if (points.some(([x,y])=>!Number.isFinite(x) || !Number.isFinite(y))) {
      valid=false;
      continue;
    }
    const ring=normalize(points);
    if (ring.length<3) {
      valid=false;
      continue;
    }
    const edges=edgesOf(ring);
    const area=Math.abs(areaOf(ring));
    if (area<minArea || edges.some((edge,i)=>edges.slice(i+2,i===0 ? -1 : undefined).some(next=>intersect(edge,next)))) valid=false;
    candidates.push({ring,edges,area,depth:0,parent:null});
  }
  if (!valid || !candidates.length) return {valid:false,groups:[candidates.map(({ring})=>ring)].filter(group=>group.length)};
  candidates.sort((a,b)=>b.area-a.area);
  for (const [i,child] of candidates.entries()) {
    for (let j=i-1;j>=0;j--) {
      const parent=candidates[j];
      if (child.edges.some(edge=>parent.edges.some(other=>intersect(edge,other)))) {
        return {valid:false,groups:[candidates.map(({ring})=>ring)]};
      }
      if (!child.parent && contains(parent.ring,child.ring[0])) {
        child.depth=parent.depth+1;
        child.parent=parent;
      }
    }
    if ((areaOf(child.ring)>0)===(child.depth%2===1)) child.ring.reverse();
  }
  return {valid:true,groups:candidates.filter(item=>item.depth%2===0).map(outer=>[
    outer.ring,...candidates.filter(item=>item.parent===outer).map(item=>item.ring),
  ])};
}

// Clipping preserves winding and keeps all pieces convex. Face boundaries
// can share sub-edges, but the pieces on either side use the same height field.
function clip(points, plane) {
  const output=[];
  let previous=points.at(-1);
  let prior=value(plane,previous);
  for (const point of points) {
    const now=value(plane,point);
    if ((now>0)!==(prior>0)) output.push(lerpPoint(previous,point,prior/(prior-now)));
    if (now>=0) output.push(point);
    previous=point;
    prior=now;
  }
  const clean=normalize(output);
  return clean.length>=3 && areaOf(clean)>epsilon**2 ? clean : null;
}

function envelope(cells, planes, lower) {
  const faces=[];
  for (const cell of cells) for (const [i,plane] of planes.entries()) {
    let points=cell;
    for (let j=0;points && j<planes.length;j++) {
      if (j===i) continue;
      const cut=lower ? difference(planes[j],plane) : difference(plane,planes[j]);
      if (cut.every(v=>Math.abs(v)<epsilon)) {
        if (j<i) points=null;
      } else points=clip(points,cut);
    }
    if (points) faces.push({points,plane});
  }
  return faces;
}

function convex(ring) {
  return ring.every((p,i)=>cross2(ring[(i+ring.length-1)%ring.length],p,ring[(i+1)%ring.length])>=-epsilon);
}

function rectangular(ring) {
  return ring.length===4 && ring.every(([x,y],i)=>{
    const [ax,ay]=ring[(i+3)%4], [bx,by]=ring[(i+1)%4];
    return Math.abs((ax-x)*(bx-x)+(ay-y)*(by-y))<=.14*Math.hypot(ax-x,ay-y)*Math.hypot(bx-x,by-y);
  });
}

function inward([a,b]) {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  return [-dy/length,dx/length,(dy*a[0]-dx*a[1])/length];
}

// Exact vertical slabs through the footprint vertices. Even-odd edge pairs
// decompose the interior into trapezoids, including the gaps at courtyards.
function slabs(rings) {
  const segments=rings.flatMap(edgesOf).filter(([a,b])=>Math.abs(b[0]-a[0])>epsilon);
  const xs=rings.flat().map(([x])=>x).sort((a,b)=>a-b).filter((x,i,all)=>i===0 || x-all[i-1]>epsilon);
  const cells=[];
  for (let i=1;i<xs.length;i++) {
    const west=xs[i-1],east=xs[i],mid=(west+east)/2;
    const crossed=segments.filter(([a,b])=>(a[0]>mid)!==(b[0]>mid)).map(([a,b])=>{
      const y=(x)=>a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);
      return [y(mid),y(west),y(east)];
    }).sort((a,b)=>a[0]-b[0]);
    if (crossed.length%2) return null;
    for (let j=0;j<crossed.length;j+=2) {
      const [,lw,le]=crossed[j], [,uw,ue]=crossed[j+1];
      const cell=distinct([[west,lw],[east,le],[east,ue],[west,uw]]);
      if (cell.length>=3 && areaOf(cell)>minArea) cells.push(cell);
    }
  }
  return cells;
}

function principalAxis(ring) {
  const edges=edgesOf(ring);
  const [a,b]=edges.reduce((best,edge)=>{
    const length=([p,q])=>Math.hypot(q[0]-p[0],q[1]-p[1]);
    return length(edge)>length(best) ? edge : best;
  });
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  const sign=dx<0 || (dx===0 && dy<0) ? -1 : 1;
  return [sign*dx/length,sign*dy/length];
}

// For distance to a finite segment in the square metric, its r-neighborhood
// is the segment plus an axis-aligned square of radius r. The six supporting
// planes of that polygon give its distance as a maximum of linear functions.
// Their lower envelope gives joined planar wings, valleys and open courts.
function edgeDistance(edge) {
  const [a,b]=edge;
  const normal=inward(edge);
  const component=Math.abs(normal[0])+Math.abs(normal[1]);
  const side=normal.map(v=>v/component);
  return [
    [1,0,-Math.max(a[0],b[0])],[-1,0,Math.min(a[0],b[0])],
    [0,1,-Math.max(a[1],b[1])],[0,-1,Math.min(a[1],b[1])],side,negative(side),
  ];
}

function compound(rings) {
  const cells=slabs(rings);
  if (!cells) return null;
  const segments=rings.flatMap(edgesOf).map(edgeDistance);
  const faces=[];
  for (const cell of cells) {
    const center=cell.reduce(([x,y],p)=>[x+p[0]/cell.length,y+p[1]/cell.length],[0,0]);
    const ordered=segments.map(planes=>({planes,d:Math.max(...planes.map(plane=>value(plane,center)))})).sort((a,b)=>a.d-b.d);
    let pieces=envelope([cell],ordered[0].planes,false);
    for (const {planes} of ordered.slice(1)) {
      const next=[];
      for (const piece of pieces) {
        const cuts=planes.map(plane=>difference(piece.plane,plane));
        let domain=piece.points;
        for (const cut of cuts) {
          if (!domain) break;
          domain=clip(domain,cut);
        }
        if (!domain || cuts.some(cut=>cut.every(v=>Math.abs(v)<epsilon))) {
          next.push(piece);
          continue;
        }
        let remainder=piece.points;
        for (const cut of cuts) {
          if (!remainder) break;
          const outside=clip(remainder,negative(cut));
          if (outside) next.push({points:outside,plane:piece.plane});
          remainder=clip(remainder,cut);
        }
        next.push(...envelope([domain],planes,false));
      }
      if (next.length+faces.length>900) return null;
      pieces=next;
    }
    faces.push(...pieces);
  }
  return {faces};
}

const profiles = {
  gabled: [[0,0],[.5,1],[1,0]],
  skillion: [[0,1],[1,0]],
  gambrel: [[0,0],[.22,.67],[.5,1],[.78,.67],[1,0]],
  mansard: [[0,0],[.2,.75],[.36,1],[.64,1],[.8,.75],[1,0]],
  saltbox: [[0,0],[.34,1],[1,0]],
  round: [[0,0],[.10,.51],[.25,.86],[.5,1],[.75,.86],[.9,.51],[1,0]],
};
const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function profileAxis(tags, [axisX,axisY]) {
  const direction=tags['roof:direction'];
  if (direction!==undefined) {
    const index=compass.indexOf(String(direction).toUpperCase());
    const degrees=index<0 ? Number(direction) : index*22.5;
    if (Number.isFinite(degrees) && degrees>=0 && degrees<=360) {
      const angle=degrees*Math.PI/180;
      // The first axis is the long axis in local metric coordinates. Convert
      // back-to-front compass bearings to the roof's across-ridge direction.
      const [x,projectedY]=projectMeters(Math.sin(angle),Math.cos(angle));
      const y=projectedY/region.pitch;
      return [x*axisX+y*axisY,-x*axisY+y*axisX];
    }
  }
  return tags['roof:orientation']==='across' ? [1,0] : [0,1];
}

function section(ring, type, across) {
  const view=ring.map(([x,y])=>x*across[0]+y*across[1]);
  const lo=Math.min(...view),hi=Math.max(...view),width=hi-lo;
  if (width<1) return null;
  const profile=profiles[type==='half-hipped' ? 'gabled' : type];
  const offset=[across[0]/width,across[1]/width,-lo/width];
  const planes=profile.slice(1).map(([x,y],i)=>{
    const [u,v]=profile[i],slope=(y-v)/(x-u);
    return [offset[0]*slope,offset[1]*slope,offset[2]*slope+v-u*slope];
  });
  // All supported profiles are concave across the section, so their planar
  // strips are just the lower envelope; the same applies to the clipped hips.
  if (type==='half-hipped') {
    const along=[across[1],-across[0]];
    const length=ring.map(([x,y])=>x*along[0]+y*along[1]);
    const start=Math.min(...length),end=Math.max(...length);
    if (end-start<width*.8) return null;
    const k=2/width;
    planes.push([along[0]*k,along[1]*k,.46-start*k],[-along[0]*k,-along[1]*k,.46+end*k]);
  }
  const heightAt=(p)=>Math.max(0,Math.min(...planes.map(plane=>value(plane,p))));
  return {faces:envelope([ring],planes,true),heightAt,profile:true};
}

function pyramid(ring) {
  const center=ring.reduce(([x,y],p)=>[x+p[0]/ring.length,y+p[1]/ring.length],[0,0]);
  const faces=edgesOf(ring).map(edge=>{
    const plane=inward(edge),distance=value(plane,center);
    return {points:[...edge,center],plane:plane.map(v=>v/distance)};
  });
  return {faces};
}

function roofHeight(tags, {total,minimum}, peak, grade, shape) {
  const number=(source)=>Number.isFinite(parseFloat(source)) ? parseFloat(source) : 0;
  const raw=String(tags['roof:height']??'').trim();
  const imperial=raw.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/i);
  const tagged=imperial ? Number(imperial[1])*.3048+Number(imperial[2]??0)*.0254 : number(raw);
  const angle=number(tags['roof:angle']);
  const levels=number(tags['roof:levels']);
  const usable=Math.max(0,total-minimum-1.1);
  const inferred=Math.min(8,usable*.57,peak/grade*(shape==='skillion' ? .28 : .62));
  const requested=tagged>0 ? tagged : angle>0 && angle<75 ? Math.tan(angle*Math.PI/180)*peak/grade :
    levels>0 ? levels*2.5 : inferred;
  return Math.min(usable,20,peak/grade*2.7,requested);
}

function wallRim(rings, faces, heightAt) {
  const points=faces.flatMap(face=>face.points);
  return rings.map(ring=>edgesOf(ring).flatMap(([a,b])=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
    const cuts=[0];
    for (const [x,y] of points) {
      const u=((x-a[0])*dx+(y-a[1])*dy)/length2;
      if (u>epsilon && u<1-epsilon && Math.abs((x-a[0])*dy-(y-a[1])*dx)<epsilon*Math.sqrt(length2)) cuts.push(u);
    }
    cuts.sort((p,q)=>p-q);
    return cuts.filter((t,i)=>i===0 || t-cuts[i-1]>epsilon).map(t=>{
      const point=lerpPoint(a,b,t);
      return [...point,heightAt(point)];
    });
  }));
}

// Ring roles are reconstructed from containment because the compact atlas
// extract stores the paths together. Nested islands become independent shells.
export function buildRoof(projectedRings, pitch, tags, policy) {
  const anchor=projectedRings.find(ring=>ring.length)?.find(([x,y])=>Number.isFinite(x) && Number.isFinite(y));
  if (!anchor) return {valid:false,reason:'invalid footprint',shells:[]};
  const [ox,oy]=anchor;
  const local=projectedRings.map(ring=>ring.map(([x,y])=>[x-ox,(y-oy)/pitch]));
  const {valid,groups}=footprint(local);
  const shells=groups.map(rings=>{
    const asProjected=([x,y])=>[x+ox,y*pitch+oy];
    const closed=rings.map(ring=>close(ring.map(asProjected)));
    const flat=(reason)=>({type:'flat',height:0,rings:closed,rim:[],facets:[],reason});
    if (!valid) return flat('invalid footprint');
    const explicit=tags['roof:shape'];
    let type=explicit==='lean_to' ? 'skillion' : explicit ?? policy.infer;
    if (!type || type==='flat') return flat();
    if (!Object.hasOwn(profiles,type) && !['hipped','half-hipped','pyramidal'].includes(type)) return flat('unsupported mapped roof form');
    const size=rings.reduce((sum,ring)=>sum+ring.length,0);
    if (size>42) return flat('footprint complexity');
    const axis=principalAxis(rings[0]);
    const [cos,sin]=axis;
    const metric=rings.map(ring=>ring.map(([x,y])=>[x*cos+y*sin,-x*sin+y*cos]));
    const fromMetric=([x,y])=>asProjected([x*cos-y*sin,x*sin+y*cos]);
    const [outer]=metric;
    const simple=metric.length===1 && convex(outer);
    const across=profileAxis(tags,axis);
    let plan;
    if ((Object.hasOwn(profiles,type) || type==='half-hipped') && simple && (explicit || rectangular(outer))) {
      plan=section(outer,type,across);
    }
    if (type==='pyramidal' && simple) plan=pyramid(outer);
    if (!plan) {
      if (explicit && type!=='hipped' && type!=='gabled') return flat('roof form incompatible with outline');
      type='hipped';
      if (simple) {
        const planes=edgesOf(outer).map(inward);
        plan={faces:envelope([outer],planes,true)};
      } else if (size<=30) plan=compound(metric);
    }
    if (!plan?.faces.length) return flat('roof plane construction');
    const wantedArea=metric.reduce((sum,ring)=>sum+areaOf(ring),0);
    const covered=plan.faces.reduce((sum,{points})=>sum+areaOf(points),0);
    if (Math.abs(covered-wantedArea)>Math.max(.002,wantedArea*.00005)) return flat('roof coverage validation');
    let peak=0,grade=0;
    for (const {points,plane} of plan.faces) {
      grade=Math.max(grade,Math.hypot(plane[0],plane[1]));
      for (const point of points) peak=Math.max(peak,value(plane,point));
    }
    const height=roofHeight(tags,policy,peak,grade,type);
    if (!Number.isFinite(height) || height<.28 || peak<epsilon) return flat('limited structural height');
    const elevation=(h)=>Math.max(0,Math.min(height,h/peak*height));
    const facets=plan.faces.map(({points,plane})=>points.map(p=>[...fromMetric(p),elevation(value(plane,p))]));
    if (facets.some(face=>areaOf(face)<=0 || face.some(point=>point.some(v=>!Number.isFinite(v))))) return flat('roof winding validation');
    const rim=plan.profile ? wallRim(metric,plan.faces,plan.heightAt).map(ring=>close(ring.map(([x,y,z])=>[...fromMetric([x,y]),elevation(z)]))) :
      closed.map(ring=>ring.map(p=>[...p,0]));
    return {type,height,rings:closed,rim,facets};
  });
  return {valid,reason:valid ? undefined : 'invalid footprint',shells};
}

// A single light direction is shared with walls and cast shadows.
export function roofLight(slopeX, slopeY) {
  const magnitude=Math.hypot(slopeX,slopeY);
  return magnitude<1e-5 ? 0 : Math.round(26*(slopeX*.72+slopeY*.69)/magnitude);
}
