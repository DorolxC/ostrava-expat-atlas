import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { project, region, toGeographic } from '../public/js/geo.js';
import { Raster, png } from './raster.mjs';
import { outside, paintSection } from './art.mjs';
import { coverageField, extent, projectedRings } from './coverage.mjs';
import { reliefSampler } from './relief.mjs';
import { loadBlenderModels } from './blender-models.mjs';

const output = new URL('../public/map/',import.meta.url);
const load = (name) => readFile(new URL(name,output),'utf8').then(JSON.parse);
const tileSize = 896;
const sectionSize = tileSize*2;
const overhang = 205;
const chunkMeters = 1900;
const encoder = process.env.OSTRAVA_CWEBP;
const extension = encoder ? 'webp' : 'png';
const artStyles = ['atlas', 'foundry', 'daylight', 'lithograph', 'afternoon', 'overcast'];
const defaultStyle = 'afternoon';
const lowLevel = {name:'atlas',scale:2.78,minZoom:0.34};

const close = ([lon,lat,w,h,oy=0]) => {
  const [x,y] = project(lon,lat);
  return {left:x-w/2,top:y+oy-h/2,right:x+w/2,bottom:y+oy+h/2};
};
const highlights = [
  [18.29035,49.83555,1330,840,-46],
  [18.27820,49.81967,1060,715,-53],
  [18.17403,49.82310,910,660,-27],
  [18.29105,49.84295,950,735,-36],
];
const pilots = ['centre','ironworks'];
const plans = [
  ...highlights.map((focus,i)=>({name:'street-'+i,box:close(focus),scale:4.25,minZoom:3.05,pilot:pilots[i]})),
];
const thumbnails = [
  ['ironworks.png',[18.2780,49.81943,350,192,-28],'ironworks'],
  ['city-centre.png',[18.29137,49.83542,320,162,-18],'centre'],
  ['poruba.png',[18.17415,49.82468,355,172,-22]],
];

async function loadScene() {
  const [geography,boundary,landmarks,extra,elevations] = await Promise.all([
    load('geometry.json'),load('boundary.json'),load('landmarks.json'),
    load('street-detail.json'),load('relief.json'),
  ]);
  const coverage = coverageField(projectedRings(boundary),region.pitch);
  const structures=[...landmarks.structures,...await loadBlenderModels()];
  const relief = reliefSampler(elevations);
  const bins = new Map();
  const key = (x,y)=>x+','+y;
  for (const [order,f] of [...geography.features,...extra.points].entries()) {
    const paths = f.points.map((path)=>path.map((p)=>project(...p)));
    const box = extent(paths);
    const entry = {id:f.id,kind:f.kind,tags:f.tags,paths,box,order};
    for (let y=Math.floor(box.top/chunkMeters);y<=Math.floor(box.bottom/chunkMeters);y++) {
      for (let x=Math.floor(box.left/chunkMeters);x<=Math.floor(box.right/chunkMeters);x++) {
        const id=key(x,y);
        if (!bins.has(id)) bins.set(id,[]);
        bins.get(id).push(entry);
      }
    }
  }

  function gather(left,top,right,bottom) {
    const found = new Set();
    for (let y=Math.floor(top/chunkMeters);y<=Math.floor(bottom/chunkMeters);y++) {
      for (let x=Math.floor(left/chunkMeters);x<=Math.floor(right/chunkMeters);x++) {
        for (const f of bins.get(key(x,y))??[]) {
          if (f.box.right>=left && f.box.bottom>=top && f.box.left<=right && f.box.top<=bottom) found.add(f);
        }
      }
    }
    // Neighboring overlapping sections can start in different bins. Paint in
    // source order, not the order features were encountered in those bins.
    return [...found].sort((a,b)=>a.order-b.order);
  }

  function render(scale,ox,oy,width,height,recordTree,pilot,style,recordRoof) {
    const layers = new Map();
    for (const f of gather(ox/scale,oy/scale,(ox+width)/scale,(oy+height)/scale)) {
      if (!layers.has(f.kind)) layers.set(f.kind,[]);
      const rings = f.paths.map((path)=>path.map(([x,y])=>[x*scale-ox,y*scale-oy]));
      layers.get(f.kind).push({id:f.id,kind:f.kind,tags:f.tags,rings,worldRings:f.paths});
    }
    const screen = (xy)=>{
      const [x,y] = project(...xy);
      return [x*scale-ox,y*scale-oy];
    };
    const raster = paintSection({scale,ox,oy,width,height,layers,landmarks:structures,screen,relief,recordTree,recordRoof,pilot,style});
    if (!workerData?.canopiesOnly && !workerData?.depth) coverage.blend(raster,scale,ox,oy,outside);
    return raster;
  }
  return {coverage,render,bounds:geography.bounds,featureCount:geography.features.length};
}

function frame(box,scale) {
  const ox = Math.floor(box.left*scale);
  const oy = Math.floor(box.top*scale);
  return {ox,oy,scale,width:Math.ceil(box.right*scale)-ox,height:Math.ceil(box.bottom*scale)-oy};
}

function cropOverview(raster,padding,tx,ty,w,h,step,overview) {
  const half = Math.trunc(step/3);
  for (let y=Math.ceil(ty/step);y<Math.ceil((ty+h)/step);y++) {
    for (let x=Math.ceil(tx/step);x<Math.ceil((tx+w)/step);x++) {
      const at = (padding+y*step-ty)*raster.width+padding+x*step-tx;
      const a = raster.pixels[at-half];
      const b = raster.pixels[at+half];
      const c = raster.pixels[at-raster.width*half];
      const d = raster.pixels[at+raster.width*half];
      const red = ((a>>16)+(b>>16)+(c>>16)+(d>>16))>>2;
      const green = (((a>>8)&255)+((b>>8)&255)+((c>>8)&255)+((d>>8)&255))>>2;
      const blue = ((a&255)+(b&255)+(c&255)+(d&255))>>2;
      overview.pixels[y*overview.width+x]=(red<<16)|(green<<8)|blue;
    }
  }
}

async function writeTile(target,raster,padding,x,y,w,h,alphaAt) {
  const bytes = png(raster,padding+x,padding+y,w,h,1,encoder ? 1 : 5,alphaAt);
  if (!encoder) {
    await writeFile(target,bytes);
    return;
  }
  const input = new URL(target.href+'.source.png');
  await writeFile(input,bytes);
  try {
    await new Promise((resolve,reject)=>{
      const child = spawn(encoder,['-quiet','-z','1',fileURLToPath(input),'-o',fileURLToPath(target)],{
        stdio:['ignore','ignore','inherit'],windowsHide:true,
      });
      child.once('error',reject);
      child.once('close',(code)=>code===0 ? resolve() : reject(new Error('cwebp exited with '+code)));
    });
  } finally {
    await unlink(input);
  }
}

function edgeAlpha(level,x,y,w,h) {
  if (level.name==='atlas') return undefined;
  // Only feather the boundary of the whole detail frame. Every tile evaluates
  // the same continuous function, so internal joins cannot create new edges.
  const feather=145*level.scale;
  if (Math.min(x,y,level.width-x-w,level.height-y-h)>=feather) return undefined;
  return (tx,ty)=>{
    const px=x+tx;
    const py=y+ty;
    const distance=Math.min(px,py,level.width-1-px,level.height-1-py);
    const t=Math.min(1,distance/feather);
    return Math.round(255*t*t*(3-2*t));
  };
}

async function drawLevel(scene,plan,canopies,rows,style,section,targets) {
  const {name,scale,minZoom} = plan;
  const data = {...frame(plan.box??scene.coverage.frame,scale),name,minZoom,tiles:[]};
  const step = Math.round(13*scale/1.16);
  const onlyCanopies=!!rows;
  const overview = name==='atlas' && !onlyCanopies && !targets ? new Raster(Math.ceil(data.width/step),Math.ceil(data.height/step),outside) : null;
  const padding = Math.ceil(overhang*scale);
  const directory = new URL(name+'/',output);
  if (!onlyCanopies) await mkdir(directory,{recursive:true});
  for (let y=0;y<data.height;y+=sectionSize) {
    const slots=rows ?? section;
    if (slots && Math.floor(y/sectionSize)%slots.count!==slots.index) continue;
    for (let x=0;x<data.width;x+=sectionSize) {
      const w = Math.min(sectionSize,data.width-x);
      const h = Math.min(sectionSize,data.height-y);
      const gx = data.ox+x;
      const gy = data.oy+y;
      if (targets && !targets.some(({area:[left,top,right,bottom]})=>
        gx<right*scale && gx+w>left*scale && gy<bottom*scale && gy+h>top*scale)) continue;
      if (!scene.coverage.containsArea(gx/scale,gy/scale,(gx+w)/scale,(gy+h)/scale)) continue;
      const recordTree=canopies && ((px,py,radius,salt,conifer,forest)=>{
        if (px<padding || py<padding || px>=padding+w || py>=padding+h) return;
        if (forest && Math.abs(salt%4)!==0) return;
        canopies.push([
          Math.round((gx-padding+px)/scale*10)/10,
          Math.round((gy-padding+py)/scale*10)/10,
          Math.round(radius/scale*10)/10,
          Math.abs(salt%256), Number(!!conifer),
        ]);
      });
      const raster = scene.render(scale,gx-padding,gy-padding,w+2*padding,h+2*padding,recordTree,style ? undefined : plan.pilot,style);
      if (onlyCanopies) continue;
      const jobs = [];
      if (overview) cropOverview(raster,padding,x,y,w,h,step,overview);
      for (let ty=0;ty<h;ty+=tileSize) {
        for (let tx=0;tx<w;tx+=tileSize) {
          const tw=Math.min(tileSize,w-tx);
          const th=Math.min(tileSize,h-ty);
          if (!scene.coverage.containsArea((gx+tx)/scale,(gy+ty)/scale,(gx+tx+tw)/scale,(gy+ty+th)/scale)) continue;
          const filename=name+'/'+(x+tx)/tileSize+'-'+(y+ty)/tileSize+'.'+extension;
          data.tiles.push({x:x+tx,y:y+ty,w:tw,h:th,name:filename});
          jobs.push(writeTile(new URL(filename,output),raster,padding,tx,ty,tw,th,edgeAlpha(data,x+tx,y+ty,tw,th)));
        }
      }
      await Promise.all(jobs);
    }
    console.log(name+' row '+Math.min(y+sectionSize,data.height)+'/'+data.height+' ('+
      (onlyCanopies ? canopies.length+' crowns' : data.tiles.length+' tiles')+')');
  }
  if (onlyCanopies || targets) return data;
  if (section) {
    if (overview) data.preview={width:overview.width,height:overview.height,pixels:overview.pixels,step};
    return data;
  }
  if (overview) await writeFile(new URL('overview.png',output),png(overview));
  await pruneTiles(data);
  return data;
}

async function pruneTiles(data) {
  const {name}=data;
  const directory=new URL(name+'/',output);
  const active=new Set(data.tiles.map(({name})=>name));
  for (const file of await readdir(directory)) {
    if (/^\d+-\d+\.(?:png|webp)$/.test(file) && !active.has(name+'/'+file)) await unlink(new URL(file,directory));
  }
}

async function thumbnail(scene,target,location,scale=3.2,pilot,style,recordRoof) {
  const {ox,oy,width,height}=frame(close(location),scale);
  const padding=Math.ceil(overhang*scale);
  const raster=scene.render(scale,ox-padding,oy-padding,width+padding*2,height+padding*2,undefined,style ? undefined : pilot,style,recordRoof);
  await writeFile(target,png(raster,padding,padding,width,height));
}

function runWorker(task) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:task});
    worker.once('message',resolve);
    worker.once('error',reject);
    worker.once('exit',(code)=>{ if(code!==0) reject(new Error('Artwork worker exited '+code)); });
  });
}

async function writeCanopies(results) {
  const canopies=results.flatMap((part)=>part.canopies);
  canopies.sort((a,b)=>a[1]-b[1] || a[0]-b[0]);
  await writeFile(new URL('canopies.json',output),JSON.stringify(canopies));
  console.log('Recorded '+canopies.length+' painted tree crowns.');
}

async function writeManifest(manifest) {
  const digest=createHash('sha256');
  for (const tile of [manifest,...manifest.closeups].flatMap(level=>level.tiles)) {
    digest.update(tile.name).update(await readFile(new URL(tile.name,output)));
  }
  manifest.tileRevision=digest.digest('hex').slice(0,16);
  await writeFile(new URL('scene.json',output),JSON.stringify(manifest));
}

function requestedPilot() {
  const option=process.argv.indexOf('--pilot');
  if (option===-1) return undefined;
  const pilot=process.argv[option+1];
  if (!pilots.includes(pilot)) throw new Error('Use --pilot centre or --pilot ironworks.');
  return pilot;
}

function requestedStyle(fallback) {
  const option=process.argv.indexOf('--style');
  if (option===-1) return fallback;
  const style=process.argv[option+1];
  if (style==='baseline') return undefined;
  if (!artStyles.includes(style)) throw new Error('Use --style '+[...artStyles,'baseline'].join(', ')+'.');
  return style;
}

if (!isMainThread && workerData.depth) {
  const {depthField}=await import('./world-depth.mjs');
  const scene=await loadScene();
  const {depth,style}=workerData;
  parentPort.postMessage(depth.map(({id,bounds})=>({id,...depthField(scene.render,bounds,style)})));
} else if (!isMainThread) {
  const scene = await loadScene();
  const { plans: jobs, canopiesOnly: rows, pilotOnly, style, section, targets }=workerData;
  const levels = [];
  const canopies = [];
  for (const plan of jobs) levels.push(await drawLevel(scene,plan,plan.name==='atlas' && !targets ? canopies : undefined,rows,style,section,targets));
  if (pilotOnly || jobs.some(({name})=>name==='street-0')) {
    for (const [file,location,pilot] of thumbnails) {
      if (!pilotOnly || jobs.some(plan=>plan.pilot===pilot)) await thumbnail(scene,new URL(file,output),location,3.2,pilot,style);
    }
  }
  const previews=levels.flatMap(level=>level.preview ? [level.preview.pixels.buffer] : []);
  parentPort.postMessage({levels,bounds:scene.bounds,city:scene.coverage.box,features:scene.featureCount,canopies},previews);
} else if (process.argv.includes('--refresh-blender-materials')) {
  // Local repaint for changes to mesh pigments. Moving geometry requires a
  // full bake so that the overview and static environment data can follow it.
  const manifest=await load('scene.json');
  const targets=(await loadBlenderModels()).map(({point,reach})=>{
    const [x,y]=project(...point);
    return {area:[x-reach,y-reach,x+reach,y+reach]};
  });
  const levels=[lowLevel,...plans];
  const published=[manifest,...manifest.closeups];
  for (const level of levels) {
    const old=published.find(item=>item.name===level.name);
    if (old?.scale!==level.scale || old.tiles.some(tile=>!tile.name.endsWith('.'+extension))) {
      throw new Error('Mesh material updates require the current atlas layout and tile encoder.');
    }
  }
  const results=await Promise.all(levels.map(plan=>runWorker({plans:[plan],style:manifest.artStyle,targets})));
  await writeManifest(manifest);
  console.log('Repainted material on '+results.flatMap(result=>result.levels).reduce((sum,level)=>sum+level.tiles.length,0)+' tiles.');
} else if (process.argv.includes('--canopies')) {
  const {artStyle:style}=await load('scene.json');
  const count=Math.max(1,Math.min(4,availableParallelism()-1));
  const results=await Promise.all(Array.from({length:count},(_,index)=>
    runWorker({plans:[lowLevel],canopiesOnly:{index,count},style})));
  await writeCanopies(results);
} else if (process.argv.includes('--pilots')) {
  const manifest=await load('scene.json');
  const selectedPilot=requestedPilot();
  const targets=plans.filter(plan=>plan.pilot && (!selectedPilot || plan.pilot===selectedPilot));
  for (const target of targets) {
    const existing=manifest.closeups.find(layer=>layer.name===target.name);
    if (!existing || existing.tiles.some(tile=>!tile.name.endsWith('.'+extension))) {
      throw new Error('Pilot generation must use the existing tile format. Set OSTRAVA_CWEBP for WebP.');
    }
  }
  const results=await Promise.all(targets.map(plan=>runWorker({plans:[plan],pilotOnly:true,style:manifest.artStyle})));
  const byName=new Map(results.flatMap(result=>result.levels).map(layer=>[layer.name,layer]));
  manifest.closeups=manifest.closeups.map(layer=>byName.get(layer.name)??layer);
  await writeManifest(manifest);
  console.log('Repainted '+[...byName.values()].reduce((sum,level)=>sum+level.tiles.length,0)+' existing pilot tiles.');
} else if (process.argv.includes('--sample')) {
  const at=process.argv.indexOf('--sample');
  const index=Number(process.argv[at+1]??0);
  if (!highlights[index]) throw new Error('Sample index must be 0 through 3.');
  const scene=await loadScene();
  const loc=highlights[index];
  const destination=process.argv[at+2]??'sample-'+index+'.png';
  const pilot=requestedPilot();
  await thumbnail(scene,destination,[loc[0],loc[1],450,270,loc[4]],3.55,pilot,requestedStyle(pilot ? undefined : defaultStyle));
  console.log('Rendered '+destination);
} else if (process.argv.includes('--audit-crop')) {
  const at=process.argv.indexOf('--audit-crop');
  const [lon,lat,w,h,alpha]=process.argv.slice(at+1,at+6).map(Number);
  const destination=process.argv[at+6];
  if (![lon,lat,w,h,alpha].every(Number.isFinite) || w<=0 || h<=0 || alpha<=0 || !destination) {
    throw new Error('Usage: node scripts/render.mjs --audit-crop lon lat width-in-m height-in-m scale out.png');
  }
  const pilot=requestedPilot();
  const roofOption=process.argv.indexOf('--roof-id');
  const roofId=roofOption<0 ? undefined : process.argv[roofOption+1];
  let roof;
  const recordRoof=roofId ? (feature,plan)=>{
    if (feature.id===roofId) roof={id:roofId,tags:feature.tags,footprint:feature.worldRings,total:feature.design.total,minimum:feature.design.minimum,...plan};
  } : undefined;
  await thumbnail(await loadScene(),destination,[lon,lat,w,h],alpha,pilot,requestedStyle(pilot ? undefined : defaultStyle),recordRoof);
  if (roofId) {
    if (!roof) throw new Error('No generated roof for '+roofId+' in this crop');
    const { roofPreview }=await import('./roof-diagram.mjs');
    await writeFile(destination+'.roof.json',JSON.stringify(roof));
    await writeFile(destination+'.roof.html',roofPreview(roof,destination));
  }
  console.log('Rendered '+destination);
} else if (process.argv.includes('--world-depth')) {
  const { writeDepthAssets }=await import('./world-depth.mjs');
  const [manifest,routes]=await Promise.all([load('scene.json'),load('world-routes.json')]);
  const style=requestedStyle(manifest.artStyle);
  const count=Math.max(1,Math.min(4,availableParallelism()-1,routes.regions.length));
  const groups=Array.from({length:count},()=>[]);
  for (const [i,{id,bounds}] of routes.regions.entries()) groups[i%count].push({id,bounds});
  const parts=await Promise.all(groups.map(depth=>runWorker({depth,style})));
  const fields=new Map(parts.flat().map(field=>[field.id,field]));
  await writeDepthAssets({fields:routes.regions.map(({id})=>fields.get(id)),geometry:routes.geometry,
    revision:routes.revision,tileRevision:style===manifest.artStyle?manifest.tileRevision:null},new URL('world-depth.json',output));
} else if (process.argv.includes('--audit-seam')) {
  const at=process.argv.indexOf('--audit-seam');
  const [name,lon,lat,axis='x']=process.argv.slice(at+1,at+5);
  const plan=[lowLevel,...plans].find(p=>p.name===name);
  if (!plan || !Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat)) || !['x','y'].includes(axis)) {
    throw new Error('Usage: node scripts/render.mjs --audit-seam level lon lat [x|y]');
  }
  const scene=await loadScene();
  const style=requestedStyle((await load('scene.json')).artStyle);
  const {scale,ox,oy,width,height}=frame(plan.box??scene.coverage.frame,plan.scale);
  const [x,y]=project(Number(lon),Number(lat)).map((p,i)=>Math.floor(p*scale)-(i===0?ox:oy));
  const u=axis==='x'?x:y;
  const v=axis==='x'?y:x;
  const maxU=axis==='x'?width:height;
  const maxV=axis==='x'?height:width;
  const boundary=Math.max(sectionSize,Math.min(Math.floor((maxU-1)/sectionSize)*sectionSize,Math.round(u/sectionSize)*sectionSize));
  const block=Math.floor(v/sectionSize)*sectionSize;
  if (v<0 || v>=maxV || boundary>=maxU) throw new Error('No neighboring render sections at this location.');
  const pad=Math.ceil(overhang*scale);
  function sample(start) {
    const w=Math.min(sectionSize,maxU-start)+2*pad;
    const h=Math.min(sectionSize,maxV-block)+2*pad;
    const pilot=style ? undefined : plan.pilot;
    return axis==='x' ? scene.render(scale,ox+start-pad,oy+block-pad,w,h,undefined,pilot,style) :
      scene.render(scale,ox+block-pad,oy+start-pad,h,w,undefined,pilot,style);
  }
  function pixel(r,start,u,v) {
    return axis==='x' ? r.pixels[(v-block+pad)*r.width+(u-start+pad)] : r.pixels[(u-start+pad)*r.width+(v-block+pad)];
  }
  const left=sample(boundary-sectionSize);
  const right=sample(boundary);
  let compared=0;
  let mismatch=0;
  let largest=0;
  let firstMismatch;
  for (let a=boundary-12;a<boundary+12;a++) for(let b=Math.max(block,v-160);b<Math.min(v+160,block+sectionSize,maxV);b++) {
    const l=pixel(left,boundary-sectionSize,a,b);
    const r=pixel(right,boundary,a,b);
    compared++;
    if (l!==r) {
      mismatch++;
      if (!firstMismatch) {
        const x=ox+(axis==='x' ? a : b);
        const y=oy+(axis==='x' ? b : a);
        firstMismatch={x,y,location:toGeographic((x+.5)/scale,(y+.5)/scale),left:l,right:r};
      }
      largest=Math.max(largest,Math.abs((l>>16)-(r>>16)),Math.abs(((l>>8)&255)-((r>>8)&255)),Math.abs((l&255)-(r&255)));
    }
  }
  console.log(JSON.stringify({name,axis,boundary,compared,mismatch,largest,firstMismatch}));
  if (largest>3) process.exitCode=1;
} else {
  const style=requestedStyle(defaultStyle);
  const count=Math.max(1,Math.min(4,availableParallelism()-2));
  const shards=Array.from({length:count},(_,index)=>runWorker({plans:[lowLevel],style,section:{index,count}}));
  const results=await Promise.all([...shards,runWorker({plans,style})]);
  await writeCanopies(results);
  const [root] = results;
  const all=results.flatMap((part)=>part.levels);
  const baseSections=all.filter(({name})=>name==='atlas');
  const {preview,...base}=baseSections[0];
  base.tiles=baseSections.flatMap(layer=>layer.tiles).sort((a,b)=>a.y-b.y || a.x-b.x);
  const overview=new Raster(preview.width,preview.height,outside);
  for (let y=0;y<preview.height;y++) {
    const owner=Math.floor(y*preview.step/sectionSize)%count;
    const row=y*preview.width;
    overview.pixels.set(baseSections[owner].preview.pixels.subarray(row,row+preview.width),row);
  }
  await writeFile(new URL('overview.png',output),png(overview));
  await pruneTiles(base);
  const closeups=plans.map((plan)=>all.find(({name})=>name===plan.name));
  const manifest={...base,closeups,bounds:root.bounds,city:root.city,background:'#dcdfce',features:root.features,artStyle:style};
  await writeManifest(manifest);
  for (const name of ['detail-0','detail-1','detail-2']) {
    await pruneTiles({name,tiles:[]}).catch(error=>{if (error.code!=='ENOENT') throw error;});
  }
  const tiles=base.tiles.length+closeups.reduce((sum,level)=>sum+level.tiles.length,0);
  console.log('Rendered '+manifest.features+' mapped features and '+tiles+' tiles.');
}
