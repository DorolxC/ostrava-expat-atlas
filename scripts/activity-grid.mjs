import { project, region } from '../public/js/geo.js';

const width=560;
const height=355;
const margin=75;
const binSize=144;
const riverReach=68;
const priorities={park:5,wood:4,river:4,square:3,street:1};
const cityRivers=new Set(['Ostravice','Odra','Opava','Lučina','Porubka']);
const exempt=/^(private|no|permit|customers)$/;
const kindOf=tags=>{
  if (exempt.test(tags.access??'') || tags.landuse==='military' || tags.military) return 'restricted';
  if (tags.leisure==='park' || tags.leisure==='nature_reserve' || tags.landuse==='recreation_ground') return 'park';
  if (tags.landuse==='forest' || tags.natural==='wood' || tags.landcover==='trees') return 'wood';
  if (tags.highway==='pedestrian' || tags.place==='square') return 'square';
};

export function polygonContains(rings,x,y) {
  let hit=false;
  for (const ring of rings) for (let i=1;i<ring.length;i++) {
    const [ax,ay]=ring[i-1], [bx,by]=ring[i];
    if ((ay>y)!==(by>y) && x<ax+(bx-ax)*(y-ay)/(by-ay)) hit=!hit;
  }
  return hit;
}

function put(bins,entry,[left,top,right,bottom]) {
  for (let y=Math.floor(top/binSize);y<=Math.floor(bottom/binSize);y++) {
    for (let x=Math.floor(left/binSize);x<=Math.floor(right/binSize);x++) {
      const key=x+','+y;
      if (!bins.has(key)) bins.set(key,[]);
      bins.get(key).push(entry);
    }
  }
}

function contextAt(features) {
  const terrain=new Map(), rivers=new Map();
  for (const {kind,tags,points} of features) {
    const habitat=kind==='terrain' && kindOf(tags);
    if (habitat) {
      const rings=points.map(ring=>ring.map(p=>project(...p)));
      const box=rings.flat().reduce(([l,t,r,b],[x,y])=>[Math.min(l,x),Math.min(t,y),Math.max(r,x),Math.max(b,y)],
        [Infinity,Infinity,-Infinity,-Infinity]);
      put(terrain,{habitat,rings},box);
    } else if (kind==='waterline' && cityRivers.has(tags.name)) {
      for (const line of points) {
        const path=line.map(p=>project(...p));
        for (let i=1;i<path.length;i++) {
          const a=path[i-1], b=path[i];
          put(rivers,[a,b],[Math.min(a[0],b[0])-riverReach,Math.min(a[1],b[1])-riverReach*region.pitch,
            Math.max(a[0],b[0])+riverReach,Math.max(a[1],b[1])+riverReach*region.pitch]);
        }
      }
    }
  }
  return (x,y)=>{
    const key=Math.floor(x/binSize)+','+Math.floor(y/binSize);
    let best;
    for (const {habitat,rings} of terrain.get(key)??[]) {
      if (!polygonContains(rings,x,y)) continue;
      if (habitat==='restricted') return habitat;
      if (!best || priorities[habitat]>priorities[best]) best=habitat;
    }
    if (best) return best;
    for (const [[ax,ay],[bx,by]] of rivers.get(key)??[]) {
      const dx=bx-ax, dy=(by-ay)/region.pitch;
      const tx=x-ax, ty=(y-ay)/region.pitch;
      const length=dx*dx+dy*dy;
      if (length<.01) continue;
      const t=Math.max(0,Math.min(1,(tx*dx+ty*dy)/length));
      if ((tx-t*dx)**2+(ty-t*dy)**2<riverReach**2) return 'river';
    }
  };
}

export function activityGrid(features,roads,city) {
  const habitatAt=contextAt(features);
  const cells=new Map();
  for (const {line,tags,modes} of roads) {
    if (!modes.includes('walker') && !modes.includes('cycle')) continue;
    for (let i=1;i<line.length;i++) {
      const [ax,ay]=line[i-1], [bx,by]=line[i];
      const length=Math.hypot(bx-ax,(by-ay)/region.pitch);
      if (length<.2) continue;
      const steps=Math.ceil(length/62);
      for (let j=0;j<steps;j++) {
        const t=(j+.5)/steps;
        const x=ax+(bx-ax)*t,y=ay+(by-ay)*t;
        const habitat=habitatAt(x,y);
        if (habitat==='restricted' || !polygonContains(city,x,y)) continue;
        if (!habitat && (tags.highway==='track' || tags.highway==='path') && !/^(yes|designated|permissive)$/.test(tags.foot??tags.bicycle??'')) continue;
        const col=Math.floor(x/width),row=Math.floor(y/height);
        const id='local-'+(col<0?'w':'e')+Math.abs(col)+'-'+(row<0?'n':'s')+Math.abs(row);
        const left=col*width,top=row*height;
        const kind=habitat??(tags.highway==='pedestrian'?'square':'street');
        const previous=cells.get(id);
        const weight=priorities[kind]*12+(modes.includes('cycle')?2:0)+Math.min(length,62)/8-
          Math.hypot(x-left-width/2,y-top-height/2)/130;
        if (!previous || weight>previous.weight) {
          cells.set(id,{id,kind,weight,col,row,anchor:[x,y],core:[left,top,left+width,top+height],
            bounds:[left-margin,top-margin,left+width+margin,top+height+margin],birds:[],routes:[]});
        }
      }
    }
  }
  // Select representative cells in each part of the city. A concentration of
  // downtown paths must not displace the outer neighbourhoods and greenways.
  const buckets=new Map();
  const areas=[...cells.values()].sort((a,b)=>b.weight-a.weight || a.id.localeCompare(b.id));
  return {
    habitatAt,
    areas:areas.filter(area=>{
      const key=Math.floor(area.col/3)+','+Math.floor(area.row/3);
      const count=buckets.get(key)??0;
      if (count>=5) return false;
      buckets.set(key,count+1);
      return true;
    }),
  };
}
