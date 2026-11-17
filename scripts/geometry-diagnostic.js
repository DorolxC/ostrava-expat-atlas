import { project, region, toGeographic } from '/js/geo.js';

const $=(selector)=>document.querySelector(selector);
const frame=$('iframe');
const canvas=$('canvas');
const ctx=canvas.getContext('2d');
const readout=$('#readout');
const colors={road:'#ee8c4d',path:'#84efff',rail:'#dbb3ff',waterline:'#71acff'};
const sites=[
  ['Moravská Ostrava','18.291360,49.836250,1.590'],
  ['Masaryk Square','18.292275,49.834910,2.490'],
  ['Ostravice bridge','18.294440,49.839138,3.200'],
  ['Komenského sady junction','18.294833,49.844066,4.000'],
  ['Dolní Vítkovice junction','18.282036,49.814113,4.000'],
  ['Mariánské Hory culvert','18.241005,49.836991,3.200'],
  ['Poruba service area','18.169660,49.837860,4.000'],
  ['Covered cycleway','18.219721,49.800957,4.000'],
  ['Major interchange','18.231700,49.843990,1.440'],
  ['Street detail boundary','18.298741,49.832911,2.130'],
];

function go(view) {
  frame.src='/?view='+encodeURIComponent(view);
  const url=new URL(location.href);
  url.searchParams.set('view',view);
  history.replaceState(null,'',url);
}
for (const [title,view] of sites) $('#sites').add(new Option(title,view));
$('#sites').onchange=(event)=>{ if (event.target.value) go(event.target.value); };
go(new URL(location.href).searchParams.get('view')??sites[0][1]);

const checked=(id)=>$('#'+id).checked;
async function json(url) {
  const response=await fetch(url);
  if (!response.ok) throw new Error('Could not load '+url);
  return response.json();
}
function bounds(points) {
  let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
  for (const [x,y] of points) {
    left=Math.min(left,x); top=Math.min(top,y);
    right=Math.max(right,x); bottom=Math.max(bottom,y);
  }
  return {left,top,right,bottom};
}
function stroke(points,color,width=1,dash=[]) {
  ctx.strokeStyle=color;
  ctx.lineWidth=width;
  ctx.lineCap='round';
  ctx.lineJoin='round';
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.stroke();
}
function dot([x,y],color,r) {
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fill();
}
function distance([x,y],[ax,ay],[bx,by]) {
  const dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(x-ax-t*dx,y-ay-t*dy);
}

try {
  const [data,manifest]=await Promise.all([json('/_geometry/network.json'),json('/map/scene.json')]);
  const layers=[manifest,...manifest.closeups];
  $('#source').disabled=!data.sourceCompared;
  $('#status').textContent=data.sourceCompared ?
    data.sourceChanges+' centreline differences from raw OSM' : 'Set OSTRAVA_OSM_PBF to compare raw OSM';
  const lines=data.lines.map(f=>{
    const compiled=f.path.map(point=>project(...point));
    const source=f.source?.filter(Boolean).map(point=>project(...point));
    return {...f,compiled,source,box:bounds(source ? [...compiled,...source] : compiled)};
  });
  const junctions=data.junctions.map(point=>project(...point));
  const flags=[...data.flags,...data.reviewPoints].map(f=>({...f,world:project(...f.point)}));
  let pose='',transform,shown=[];
  function draw(force=false) {
    const view=new URL(frame.contentWindow.location.href).searchParams.get('view');
    if (!view) return;
    const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(devicePixelRatio,2);
    const id=[view,width,height,dpr].join(',');
    if (!force && pose===id) return;
    const [lon,lat,z]=view.split(',').map(Number);
    if (!Number.isFinite(lon+lat+z) || z<=0) return;
    pose=id;
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const [cx,cy]=project(lon,lat);
    const left=cx-width/(2*z), top=cy-height/(2*z), right=cx+width/(2*z), bottom=cy+height/(2*z);
    const toScreen=([x,y])=>[(x-left)*z,(y-top)*z];
    transform=(x,y)=>[left+x/z,top+y/z];
    const intersects=(box)=>box.right>=left && box.left<=right && box.bottom>=top && box.top<=bottom;
    const inView=([x,y])=>x>=left && x<=right && y>=top && y<=bottom;
    shown=lines.filter(f=>intersects(f.box));
    if (checked('seams')) {
      for (const [i,layer] of layers.entries()) {
        if ((layer.minZoom??0)>z) continue;
        for (const tile of layer.tiles) {
          const [x,y]=[(layer.ox+tile.x)/layer.scale,(layer.oy+tile.y)/layer.scale];
          const tw=tile.w/layer.scale,th=tile.h/layer.scale;
          if (!intersects({left:x,top:y,right:x+tw,bottom:y+th})) continue;
          const [sx,sy]=toScreen([x,y]);
          ctx.strokeStyle=i===0 ? '#fffc91' : '#80ebdf';
          ctx.setLineDash(i===0 ? [7,4] : [3,4]);
          ctx.strokeRect(sx,sy,tw*z,th*z);
          if(sx>=0 && sy>=0) {
            ctx.fillStyle=ctx.strokeStyle;
            ctx.fillText(tile.name,sx+5,sy+13);
          }
        }
      }
    }
    const ordered=shown.slice().sort((a,b)=>a.grade-b.grade);
    if (checked('paint') && z>.3) for (const f of ordered) {
      if (!f.visible || !f.width) continue;
      for (let i=1;i<f.compiled.length;i++) {
        const a=f.compiled[i-1],b=f.compiled[i];
        const dx=b[0]-a[0],dy=b[1]-a[1];
        const projected=Math.hypot(dx,dy)/Math.hypot(dx,dy/region.pitch);
        if (Number.isFinite(projected)) stroke([toScreen(a),toScreen(b)],'#18202780',
          Math.max(1,f.width*z*region.pitch/projected));
      }
    }
    for (const f of ordered) {
      const points=f.compiled.map(toScreen);
      if (checked('compiled')) stroke(points,colors[f.type],1.2);
      if (checked('structures') && (f.bridge || !f.visible || f.grade!==0)) {
        stroke(points,f.visible ? '#b1ff88' : '#e480ff',2.5,f.visible ? [5,4] : [2,4]);
      }
      if (checked('source') && f.source?.length>1) stroke(f.source.map(toScreen),'#fffffff0',1.4,[2,5]);
      if (checked('nodes') && z>.56) {
        for (const p of [f.compiled[0],f.compiled.at(-1)]) {
          if (inView(p)) dot(toScreen(p),'#fffa91',2.25);
        }
      }
    }
    if (checked('nodes') && z>.56) for (const p of junctions) {
      if (inView(p)) dot(toScreen(p),'#34ffae',3.1);
    }
    if (checked('flags')) for (const f of flags) {
      if (inView(f.world)) dot(toScreen(f.world),'#ff3e9f',f.detail ? 6 : 3.5);
    }
  }
  function read(event) {
    if (!transform) return;
    const point=transform(event.clientX,event.clientY);
    const [lon,lat]=toGeographic(...point);
    const locationText=lon.toFixed(7)+', '+lat.toFixed(7);
    let best=4, feature;
    for (const f of shown) {
      if (point[0]<f.box.left-best || point[0]>f.box.right+best ||
          point[1]<f.box.top-best || point[1]>f.box.bottom+best) continue;
      for (let i=1;i<f.compiled.length;i++) {
        const d=distance(point,f.compiled[i-1],f.compiled[i]);
        if (d<best) { feature=f; best=d; }
      }
    }
    const flag=checked('flags') ? flags.find(f=>Math.hypot(f.world[0]-point[0],f.world[1]-point[1])<5) : null;
    readout.value=[locationText,
      feature && [feature.id,feature.tags.name??feature.type,'layer '+feature.grade,
        feature.tags.bridge && 'bridge='+feature.tags.bridge,
        feature.tags.tunnel && 'tunnel='+feature.tags.tunnel,
        feature.tags.covered && 'covered='+feature.tags.covered,
        feature.tags.railway,feature.tags.junction && 'junction='+feature.tags.junction,
      ].filter(Boolean).join(' · '),
      flag && (flag.detail??flag.id+' → '+flag.target+' · '+flag.gap+' m · review only'),
    ].filter(Boolean).join('\n');
  }
  frame.addEventListener('load',()=>{
    frame.contentDocument.addEventListener('pointermove',read);
    draw(true);
  });
  frame.contentDocument?.addEventListener('pointermove',read);
  $('fieldset').addEventListener('change',()=>draw(true));
  setInterval(draw,120);
  draw(true);
} catch (error) {
  $('#status').textContent=error.message;
  console.error(error);
}

