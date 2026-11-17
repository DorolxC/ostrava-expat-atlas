import { region } from './geo.js';
import { createAmbientWorld } from './ambient-world.js';
import { actorBounds, createActorPainter } from './world-sprites.js';

const lift=Math.sqrt(1-region.pitch**2);
const limits={walker:{speed:1.34,turn:1.7,fade:1.2},car:{speed:8.4,turn:5.6,fade:1.1},cycle:{speed:3.9,turn:2.9,fade:1.1}};
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const ease=(t)=>{const k=clamp(t,0,1);return k*k*(3-2*k);};
const overlaps=([l,t,r,b],box)=>l<box.right && r>box.left && t<box.bottom && b>box.top;
const distance=(a,b)=>Math.hypot(b[0]-a[0],(b[1]-a[1])/region.pitch);
const modulo=(a,b)=>(a%b+b)%b;

function decodeField(field,rle) {
  const raw=atob(rle);
  if (raw.length%2) throw new Error('An actor depth field is corrupt');
  const values=new Uint8Array(field.width*field.height);
  let index=0;
  for (let i=0;i<raw.length;i+=2) {
    const count=raw.charCodeAt(i);
    if (count===0 || index+count>values.length) throw new Error('An actor depth field is the wrong size');
    values.fill(raw.charCodeAt(i+1),index,index+count);
    index+=count;
  }
  if (index!==values.length) throw new Error('An actor depth field is incomplete');
  return values;
}

function getAtDepth(field,x,y) {
  const px=Math.floor(x*field.scale)-field.x,py=Math.floor(y*field.scale)-field.y;
  if (!field.depth || px<0 || py<0 || px>=field.width || py>=field.height) return -1;
  return field.depth[py*field.width+px]*.5;
}

function indexAt(values,value) {
  let low=0,high=values.length-1;
  while (high-low>1) {
    const mid=(low+high)>>1;
    if (values[mid]<=value) low=mid;
    else high=mid;
  }
  return low;
}

function linear(points,stations,s,output) {
  const at=clamp(s,0,stations.at(-1));
  const i=indexAt(stations,at);
  const u=(at-stations[i])/(stations[i+1]-stations[i]);
  output[0]=points[i][0]+(points[i+1][0]-points[i][0])*u;
  output[1]=points[i][1]+(points[i+1][1]-points[i][1])*u;
}

function track({id,kind,points}) {
  const stations=new Float32Array(points.length),times=new Float32Array(points.length);
  const {speed,turn}=limits[kind];
  const salt=Number(id.slice(1))|0;
  const cruise=speed*(.88+(salt>>>0)%17*.014);
  let [left,top]=points[0],right=left,bottom=top;
  for (let i=1;i<points.length;i++) {
    stations[i]=stations[i-1]+distance(points[i-1],points[i]);
    const [x,y]=points[i];
    left=Math.min(left,x); right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  const previous=[0,0],next=[0,0];
  const length=stations.at(-1);
  let prior=cruise;
  for (let i=1;i<points.length;i++) {
    linear(points,stations,stations[i]-turn,previous);
    linear(points,stations,stations[i]+turn,next);
    const [x,y]=points[i];
    const ax=x-previous[0],ay=(y-previous[1])/region.pitch;
    const bx=next[0]-x,by=(next[1]-y)/region.pitch;
    const norm=Math.hypot(ax,ay)*Math.hypot(bx,by);
    const angle=norm>.01 ? clamp(1-(ax*bx+ay*by)/norm,0,1.6) : 0;
    const moving=cruise*(1-.31*ease(angle));
    times[i]=times[i-1]+(stations[i]-stations[i-1])*2/(moving+prior);
    prior=moving;
  }
  const duration=times.at(-1);
  return {id,kind,points,stations,times,bounds:[left-12,top-12,right+12,bottom+12],salt,turn,duration,
    period:duration+3+(salt>>>0)%5,agents:kind==='walker' && length>69 ? 2 : 1};
}

// Clip a sprite against the same depth convention used to bake its scenery.
// Most of the road is open, so the extra Canvas clip is created only at occluders.
function clipActor(context,actor,field,frame) {
  const {left,top,right,bottom}=actorBounds(actor.kind);
  const {x,y,scale,width,height,depth}=field;
  const l=clamp(Math.floor((actor.wx+left)*scale)-x,0,width);
  const r=clamp(Math.ceil((actor.wx+right)*scale)-x,0,width);
  const t=clamp(Math.floor((actor.wy+top)*scale)-y,0,height);
  const b=clamp(Math.ceil((actor.wy+bottom)*scale)-y,0,height);
  if (r===l || b===t) return false;
  const threshold=row=>Math.max(0,(actor.wy-(y+row+.5)/scale)/lift)*2+1.55;
  let open=0;
  for (let row=t;row<b;row++) {
    const limit=threshold(row);
    for (let col=l;col<r;col++) if (depth[row*width+col]<=limit) open++;
  }
  if (open===0) return false;
  if (open===(r-l)*(b-t)) return true;
  const clip=new Path2D();
  const [ox,oy]=frame.origin;
  const size=frame.zoom/scale;
  for (let row=t;row<b;row++) {
    const limit=threshold(row);
    let first=-1;
    for (let col=l;col<=r;col++) {
      if (col<r && depth[row*width+col]<=limit) {if(first<0)first=col;}
      else if(first>=0) {clip.rect(ox+(x+first)*size,oy+(y+row)*size,(col-first)*size,size);first=-1;}
    }
  }
  context.clip(clip);
  return true;
}

async function json(base,file,revision) {
  const url=new URL(file,base);
  url.searchParams.set('v',revision);
  const response=await fetch(url);
  if (!response.ok) throw new Error(file+' is unavailable');
  if (file.endsWith('.gz')) {
    if (!response.body || typeof DecompressionStream!=='function') throw new Error('Compressed occlusion data is unavailable in this browser');
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
  }
  return response.json();
}

export async function loadDynamicWorld(base,revision) {
  const [routes,scenery]=await Promise.all([json(base,'world-routes.json',revision),json(base,'world-depth.json',revision)]);
  if (routes.version!==1 || scenery.version!==2 || scenery.geometry!==routes.geometry || scenery.tileRevision!==revision) {
    throw new Error('City life data belongs to a different tile revision');
  }
  const fields=new Map(scenery.fields.map(field=>[field.id,field]));
  const locations=routes.regions.filter(area=>fields.has(area.id)).map(area=>({...area,tracks:area.routes.map(track),field:fields.get(area.id)}));
  const atmosphere=createAmbientWorld();
  const paintActor=createActorPainter();
  const before=[0,0],after=[0,0],position=[0,0];
  const actorPool=locations.flatMap(area=>area.tracks.flatMap(route=>Array.from({length:route.agents},(_,index)=>({route,index,field:area.field,kind:route.kind,variant:(route.salt+index*13)>>>0}))));
  const visible=[];
  let lastFrame,areas,actors,viewBounds;

  function prepare(field,now) {
    if (field.depth || field.pending || (field.failures??0)>=2 || now<(field.retryAt??0)) return;
    field.pending=true;
    json(base,field.file,revision).then(({id,tileRevision,rle})=>{
      if (id!==field.id || tileRevision!==revision) throw new Error('Foreground depth belongs to a different scene');
      field.depth=decodeField(field,rle);
    }).catch(error=>{
      field.failures=(field.failures??0)+1;
      field.retryAt=performance.now()+700;
      if (field.failures===2) console.warn('Foreground depth is unavailable for '+field.id+'.',error);
    }).finally(()=>{field.pending=false;});
  }

  function visibility(x,y,height) {
    const py=y-height*lift;
    for (const {field,bounds} of areas) {
      if (x<bounds[0] || x>bounds[2] || py<bounds[1] || py>bounds[3]) continue;
      const foreground=getAtDepth(field,x,py);
      if (foreground>=0) return 1-ease((foreground-height-.38)/1.05);
    }
    return 0;
  }

  return function paintWorld(context,frame,seconds,box,crowns,trams,paintTram) {
    if (lastFrame!==frame) {
      lastFrame=frame;
      viewBounds=box;
      areas=locations.filter(({bounds})=>overlaps(bounds,box));
      actors=actorPool.filter(({route})=>overlaps(route.bounds,box));
    }
    if (frame.scene && frame.zoom>=.82) {
      const now=performance.now();
      for (const {field} of areas) prepare(field,now);
    }
    // Atmospheric shade also belongs to the atlas grid between activity areas.
    atmosphere(context,frame,seconds,areas,areas.some(({field})=>field.depth) ? crowns() : [],visibility);
    if (frame.zoom<.93 || !actors.length) {
      for (const tram of trams) paintTram(context,frame,tram);
      return;
    }
    visible.length=0;
    const [ox,oy]=frame.origin;
    for (const actor of actors) {
      if (!actor.field.depth) continue;
      const {route,index,kind}=actor;
      const {points,stations,times,duration,period,salt,turn}=route;
      const offset=duration*(.20+(salt>>>0)%25*.019)+index*duration*.45;
      const stage=modulo(seconds+offset,period);
      if (stage>=duration) continue;
      const i=indexAt(times,stage);
      const t=(stage-times[i])/(times[i+1]-times[i]);
      const at=stations[i]+(stations[i+1]-stations[i])*t;
      linear(points,stations,at,position);
      const [wx,wy]=position;
      if (wx<viewBounds.left || wx>viewBounds.right || wy<viewBounds.top || wy>viewBounds.bottom) continue;
      linear(points,stations,at-turn,before);
      linear(points,stations,at+turn,after);
      actor.x=ox+wx*frame.zoom;
      actor.y=oy+wy*frame.zoom;
      actor.wx=wx;
      actor.wy=wy;
      actor.heading=Math.atan2((after[1]-before[1])/region.pitch,after[0]-before[0]);
      actor.phase=at*(kind==='walker'?5.65:kind==='cycle'?2.9:3.4);
      actor.opacity=ease(Math.min(stage,duration-stage)/limits[kind].fade);
      actor.zoom=frame.zoom;
      visible.push(actor);
    }
    visible.sort((a,b)=>a.wy-b.wy || a.wx-b.wx);
    let nextTram=0;
    for (const actor of visible) {
      while (nextTram<trams.length && trams[nextTram].position[1]<=actor.wy) paintTram(context,frame,trams[nextTram++]);
      context.save();
      context.globalAlpha=actor.opacity;
      if (clipActor(context,actor,actor.field,frame)) paintActor(context,actor);
      context.restore();
    }
    while (nextTram<trams.length) paintTram(context,frame,trams[nextTram++]);
  };
}
